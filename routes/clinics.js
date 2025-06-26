import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all clinics with filters
router.get('/', [
  query('search').optional().isString(),
  query('city').optional().isString(),
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

    const { search, city, specialization, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['c.is_active = 1'];
    let params = [];

    if (search) {
      whereConditions.push('(c.name LIKE ? OR c.description LIKE ? OR c.address LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (city) {
      whereConditions.push('c.city LIKE ?');
      params.push(`%${city}%`);
    }

    if (specialization) {
      whereConditions.push('c.specialization LIKE ?');
      params.push(`%${specialization}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get clinics with pagination
    const [clinics] = await pool.execute(
      `SELECT 
        c.id, c.name, c.description, c.address, c.city, c.phone, 
        c.email, c.website, c.specialization, c.created_at
      FROM Clinics c
      WHERE ${whereClause}
      ORDER BY c.name ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Clinics c WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        clinics,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get clinics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get clinics'
    });
  }
});

// Get a single clinic by ID
router.get('/:id', async (req, res) => {
  try {
    const [clinics] = await pool.execute(
      `SELECT 
        id, name, description, address, city, phone, 
        email, website, specialization, created_at
       FROM Clinics WHERE id = ? AND is_active = 1`, [req.params.id]);
    if (clinics.length === 0) {
      return res.status(404).json({ success: false, message: 'Clinic not found' });
    }
    res.json({ success: true, data: clinics[0] });
  } catch (error) {
    console.error('Error fetching clinic:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin routes
// Create a new clinic
router.post('/', [
  authenticateToken, 
  authorizeRoles('admin'),
  body('name').notEmpty().withMessage('Name is required'),
  body('description').optional().isLength({ max: 1000 }),
  body('address').notEmpty().withMessage('Address is required'),
  body('city').notEmpty().withMessage('City is required'),
  body('phone').optional().isMobilePhone(),
  body('email').optional().isEmail(),
  body('website').optional().isURL(),
  body('specialization').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, description, address, city, phone, email, website, specialization } = req.body;
  try {
    const [result] = await pool.execute(
      `INSERT INTO Clinics (name, description, address, city, phone, email, website, specialization, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [name, description, address, city, phone, email, website, specialization]
    );
    res.status(201).json({ success: true, message: 'Clinic created successfully', data: { id: result.insertId } });
  } catch (error) {
    console.error('Error creating clinic:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update a clinic
router.put('/:id', [
    authenticateToken, 
    authorizeRoles('admin'),
    body('name').optional().notEmpty().withMessage('Name is required'),
    body('description').optional().isLength({ max: 1000 }),
    body('address').optional().notEmpty().withMessage('Address is required'),
    body('city').optional().notEmpty().withMessage('City is required'),
    body('phone').optional().isMobilePhone(),
    body('email').optional().isEmail(),
    body('website').optional().isURL(),
    body('specialization').optional().isString(),
    body('is_active').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const updateData = req.body;

    delete updateData.rating;
    delete updateData.image;

    const [existing] = await pool.execute('SELECT * FROM Clinics WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Clinic not found' });
    }

    const updateFields = [];
    const updateParams = [];

    Object.keys(updateData).forEach(key => {
        updateFields.push(`${key} = ?`);
        updateParams.push(updateData[key]);
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updateFields.push('updated_at = NOW()');
    updateParams.push(id);

    const [result] = await pool.execute(
      `UPDATE Clinics SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Clinic not found' });
    }
    res.json({ success: true, message: 'Clinic updated successfully' });
  } catch (error) {
    console.error('Error updating clinic:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete a clinic (soft delete)
router.delete('/:id', [authenticateToken, authorizeRoles('admin')], async (req, res) => {
  try {
    const [result] = await pool.execute(
      'UPDATE Clinics SET is_active = 0 WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Clinic not found' });
    }
    res.json({ success: true, message: 'Clinic deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating clinic:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router; 