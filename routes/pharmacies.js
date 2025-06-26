import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all pharmacies with filters
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
      whereConditions.push('(p.name LIKE ? OR p.address LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get pharmacies with pagination
    const [pharmacies] = await pool.execute(
      `SELECT 
        p.id, p.name, p.address, p.phone, p.created_at
      FROM Pharmacies p
      WHERE ${whereClause}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Pharmacies p WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        pharmacies,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get pharmacies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pharmacies'
    });
  }
});

// Get pharmacy by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [pharmacies] = await pool.execute(
      `SELECT 
        p.id, p.name, p.address, p.phone, p.created_at
      FROM Pharmacies p
      WHERE p.id = ?`,
      [id]
    );

    if (pharmacies.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }

    const pharmacy = pharmacies[0];

    res.json({
      success: true,
      data: pharmacy
    });

  } catch (error) {
    console.error('Get pharmacy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pharmacy'
    });
  }
});

// Create pharmacy
router.post('/', [
  authenticateToken,
  authorizeRoles('admin'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('address').isLength({ max: 500 }).withMessage('Address must be less than 500 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required')
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
      name, address, phone
    } = req.body;

    // Check if pharmacy with same name already exists
    const [existingPharmacies] = await pool.execute(
      'SELECT id FROM Pharmacies WHERE name = ?',
      [name]
    );

    if (existingPharmacies.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Pharmacy with this name already exists'
      });
    }

    // Insert pharmacy
    const [result] = await pool.execute(
      `INSERT INTO Pharmacies (
        name, address, phone, created_at
      ) VALUES (?, ?, ?, NOW())`,
      [name, address, phone]
    );

    const pharmacyId = result.insertId;

    // Get created pharmacy
    const [pharmacies] = await pool.execute(
      'SELECT * FROM Pharmacies WHERE id = ?',
      [pharmacyId]
    );

    res.status(201).json({
      success: true,
      message: 'Pharmacy created successfully',
      data: pharmacies[0]
    });

  } catch (error) {
    console.error('Create pharmacy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create pharmacy'
    });
  }
});

// Update pharmacy
router.put('/:id', [
  authenticateToken,
  authorizeRoles('admin'),
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('address').optional().isLength({ max: 500 }).withMessage('Address must be less than 500 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required')
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

    // Check if pharmacy exists
    const [pharmacies] = await pool.execute(
      'SELECT id FROM Pharmacies WHERE id = ?',
      [id]
    );

    if (pharmacies.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }

    // Check if name is already taken by another pharmacy
    if (updateData.name) {
      const [existingName] = await pool.execute(
        'SELECT id FROM Pharmacies WHERE name = ? AND id != ?',
        [updateData.name, id]
      );

      if (existingName.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Pharmacy name is already taken'
        });
      }
    }

    // Build update query
    const updateFields = [];
    const updateParams = [];

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && updateData[key] !== null) {
        updateFields.push(`${key} = ?`);
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

    // Update pharmacy
    await pool.execute(
      `UPDATE Pharmacies SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated pharmacy
    const [updatedPharmacies] = await pool.execute(
      'SELECT * FROM Pharmacies WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Pharmacy updated successfully',
      data: updatedPharmacies[0]
    });

  } catch (error) {
    console.error('Update pharmacy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update pharmacy'
    });
  }
});

// Delete pharmacy
router.delete('/:id', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if pharmacy exists
    const [pharmacies] = await pool.execute(
      'SELECT id FROM Pharmacies WHERE id = ?',
      [id]
    );

    if (pharmacies.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }

    // Delete pharmacy (no soft delete in actual schema)
    await pool.execute(
      'DELETE FROM Pharmacies WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Pharmacy deleted successfully'
    });

  } catch (error) {
    console.error('Delete pharmacy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete pharmacy'
    });
  }
});

export default router; 