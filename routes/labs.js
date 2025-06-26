import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all labs with filters
router.get('/', [
  query('search').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['1=1']; // No is_active column in actual schema
    let params = [];

    if (search) {
      whereConditions.push('(L.name LIKE ? OR L.address LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get labs with pagination
    const [labs] = await pool.execute(
      `SELECT 
        L.id, L.name, L.address, L.phone, L.available_tests, L.created_at
      FROM Labs L
      WHERE ${whereClause}
      ORDER BY L.name ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Labs L WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        labs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get labs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get labs'
    });
  }
});

// Get lab by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [labs] = await pool.execute(
      `SELECT 
        L.id, L.name, L.address, L.phone, L.available_tests, L.created_at
      FROM Labs L
      WHERE L.id = ?`,
      [id]
    );

    if (labs.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found'
      });
    }

    const lab = labs[0];

    res.json({
      success: true,
      data: lab
    });

  } catch (error) {
    console.error('Get lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get lab'
    });
  }
});

// Create lab
router.post('/', [
  authenticateToken,
  authorizeRoles('admin'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('address').isLength({ max: 500 }).withMessage('Address must be less than 500 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('availableTests').optional().isString().withMessage('Available tests must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      name, address, phone, availableTests
    } = req.body;

    // Check if lab with same name already exists
    const [existingLabs] = await pool.execute(
      'SELECT id FROM Labs WHERE name = ?',
      [name]
    );

    if (existingLabs.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Lab with this name already exists'
      });
    }

    // Insert lab
    const [result] = await pool.execute(
      `INSERT INTO Labs (
        name, address, phone, available_tests, created_at
      ) VALUES (?, ?, ?, ?, NOW())`,
      [name, address, phone, availableTests]
    );

    const labId = result.insertId;

    // Get created lab
    const [labs] = await pool.execute(
      'SELECT * FROM Labs WHERE id = ?',
      [labId]
    );

    res.status(201).json({
      success: true,
      message: 'Lab created successfully',
      data: labs[0]
    });

  } catch (error) {
    console.error('Create lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create lab'
    });
  }
});

// Update lab
router.put('/:id', [
  authenticateToken,
  authorizeRoles('admin'),
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('address').optional().isLength({ max: 500 }).withMessage('Address must be less than 500 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('availableTests').optional().isString().withMessage('Available tests must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if lab exists
    const [labs] = await pool.execute(
      'SELECT id FROM Labs WHERE id = ?',
      [id]
    );

    if (labs.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found'
      });
    }

    // Check if name is already taken by another lab
    if (updateData.name) {
      const [existingName] = await pool.execute(
        'SELECT id FROM Labs WHERE name = ? AND id != ?',
        [updateData.name, id]
      );

      if (existingName.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Lab name is already taken'
        });
      }
    }

    // Build update query
    const updateFields = [];
    const updateParams = [];

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && updateData[key] !== null) {
        // Map frontend field names to database column names
        let dbField = key;
        if (key === 'availableTests') dbField = 'available_tests';
        
        updateFields.push(`${dbField} = ?`);
        updateParams.push(updateData[key]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateParams.push(id);

    // Update lab
    await pool.execute(
      `UPDATE Labs SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated lab
    const [updatedLabs] = await pool.execute(
      'SELECT * FROM Labs WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Lab updated successfully',
      data: updatedLabs[0]
    });

  } catch (error) {
    console.error('Update lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update lab'
    });
  }
});

// Delete lab
router.delete('/:id', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if lab exists
    const [labs] = await pool.execute(
      'SELECT id FROM Labs WHERE id = ?',
      [id]
    );

    if (labs.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found'
      });
    }

    // Delete lab (no soft delete in actual schema)
    await pool.execute(
      'DELETE FROM Labs WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Lab deleted successfully'
    });

  } catch (error) {
    console.error('Delete lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete lab'
    });
  }
});

export default router; 