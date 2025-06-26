import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all hospitals with filters
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
      whereConditions.push('(Hospitals.name LIKE ? OR Hospitals.address LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get hospitals with pagination
    const [hospitals] = await pool.execute(
      `SELECT 
        Hospitals.id, Hospitals.name, Hospitals.address, Hospitals.phone, 
        Hospitals.rating, Hospitals.created_at
      FROM Hospitals
      WHERE ${whereClause}
      ORDER BY Hospitals.name ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Hospitals WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        hospitals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get hospitals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get hospitals'
    });
  }
});

// Get hospital by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [hospitals] = await pool.execute(
      `SELECT 
        Hospitals.id, Hospitals.name, Hospitals.address, Hospitals.phone, 
        Hospitals.rating, Hospitals.created_at
      FROM Hospitals
      WHERE Hospitals.id = ?`,
      [id]
    );

    if (hospitals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Get hospital doctors
    const [doctors] = await pool.execute(
      `SELECT 
        d.id, d.name, d.specialization
      FROM Doctors d
      WHERE d.hospital_id = ?
      ORDER BY d.name ASC
      LIMIT 10`,
      [id]
    );

    const hospital = hospitals[0];
    hospital.doctors = doctors;

    res.json({
      success: true,
      data: hospital
    });

  } catch (error) {
    console.error('Get hospital error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get hospital'
    });
  }
});

// Create hospital
router.post('/', [
  authenticateToken,
  authorizeRoles('admin'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('address').isLength({ max: 500 }).withMessage('Address must be less than 500 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5')
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
      name, address, phone, rating
    } = req.body;

    // Check if hospital with same name already exists
    const [existingHospitals] = await pool.execute(
      'SELECT id FROM Hospitals WHERE name = ?',
      [name]
    );

    if (existingHospitals.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Hospital with this name already exists'
      });
    }

    // Insert hospital
    const [result] = await pool.execute(
      `INSERT INTO Hospitals (
        name, address, phone, rating, created_at
      ) VALUES (?, ?, ?, ?, NOW())`,
      [name, address, phone, rating || 0.0]
    );

    const hospitalId = result.insertId;

    // Get created hospital
    const [hospitals] = await pool.execute(
      'SELECT * FROM Hospitals WHERE id = ?',
      [hospitalId]
    );

    res.status(201).json({
      success: true,
      message: 'Hospital created successfully',
      data: hospitals[0]
    });

  } catch (error) {
    console.error('Create hospital error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create hospital'
    });
  }
});

// Update hospital
router.put('/:id', [
  authenticateToken,
  authorizeRoles('admin'),
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('address').optional().isLength({ max: 500 }).withMessage('Address must be less than 500 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5')
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

    // Check if hospital exists
    const [hospitals] = await pool.execute(
      'SELECT id FROM Hospitals WHERE id = ?',
      [id]
    );

    if (hospitals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Check if name is already taken by another hospital
    if (updateData.name) {
      const [existingName] = await pool.execute(
        'SELECT id FROM Hospitals WHERE name = ? AND id != ?',
        [updateData.name, id]
      );

      if (existingName.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Hospital name is already taken'
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

    // Update hospital
    await pool.execute(
      `UPDATE Hospitals SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated hospital
    const [updatedHospitals] = await pool.execute(
      'SELECT * FROM Hospitals WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Hospital updated successfully',
      data: updatedHospitals[0]
    });

  } catch (error) {
    console.error('Update hospital error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update hospital'
    });
  }
});

// Delete hospital
router.delete('/:id', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if hospital exists
    const [hospitals] = await pool.execute(
      'SELECT id FROM Hospitals WHERE id = ?',
      [id]
    );

    if (hospitals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Delete hospital (no soft delete in actual schema)
    await pool.execute(
      'DELETE FROM Hospitals WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Hospital deleted successfully'
    });

  } catch (error) {
    console.error('Delete hospital error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete hospital'
    });
  }
});

// Get hospital doctors
router.get('/:id/doctors', [
  query('specialization').optional().isString(),
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

    const { id } = req.params;
    const { specialization, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Check if hospital exists
    const [hospitals] = await pool.execute(
      'SELECT id FROM Hospitals WHERE id = ?',
      [id]
    );

    if (hospitals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    let whereConditions = ['d.hospital_id = ?'];
    let params = [id];

    if (specialization) {
      whereConditions.push('d.specialization LIKE ?');
      params.push(`%${specialization}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get doctors with pagination
    const [doctors] = await pool.execute(
      `SELECT 
        d.id, d.name, d.specialization, d.email, d.phone
      FROM Doctors d
      WHERE ${whereClause}
      ORDER BY d.name ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Doctors d WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        doctors,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get hospital doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get hospital doctors'
    });
  }
});

export default router; 