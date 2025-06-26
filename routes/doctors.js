import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import bcrypt from 'bcrypt';

const router = express.Router();

// Get all doctors with filters
router.get('/', [
  query('specialization').optional().isString(),
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

    const { specialization, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['1=1']; // No is_active column in actual schema
    let params = [];

    if (specialization) {
      whereConditions.push('Doctors.specialization LIKE ?');
      params.push(`%${specialization}%`);
    }

    if (search) {
      whereConditions.push('(Doctors.name LIKE ? OR Doctors.specialization LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get doctors with pagination
    const [doctors] = await pool.execute(
      `SELECT 
        Doctors.id, Doctors.name, Doctors.email, Doctors.phone, 
        Doctors.specialization, Doctors.hospital_id, Doctors.available_times, 
        Doctors.created_at,
        h.name as hospital_name
      FROM Doctors
      LEFT JOIN Hospitals h ON Doctors.hospital_id = h.id
      WHERE ${whereClause}
      ORDER BY Doctors.name ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Doctors WHERE ${whereClause}`,
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
    console.error('Get doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get doctors'
    });
  }
});

// Get doctor by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [doctors] = await pool.execute(
      `SELECT 
        Doctors.id, Doctors.name, Doctors.email, Doctors.phone, 
        Doctors.specialization, Doctors.hospital_id, Doctors.available_times, 
        Doctors.created_at,
        h.name as hospital_name
      FROM Doctors
      LEFT JOIN Hospitals h ON Doctors.hospital_id = h.id
      WHERE Doctors.id = ?`,
      [id]
    );

    if (doctors.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Get doctor's appointments
    const [appointments] = await pool.execute(
      `SELECT 
        a.id, a.user_id, a.date, a.status, a.created_at,
        u.name as patient_name, u.email as patient_email
      FROM Appointments a
      LEFT JOIN Users u ON a.user_id = u.id
      WHERE a.doctor_id = ?
      ORDER BY a.date DESC
      LIMIT 10`,
      [id]
    );

    const doctor = doctors[0];
    doctor.appointments = appointments;

    res.json({
      success: true,
      data: doctor
    });

  } catch (error) {
    console.error('Get doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get doctor'
    });
  }
});

// Create doctor profile
router.post('/', [
  authenticateToken,
  authorizeRoles('doctor', 'admin'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('specialization').optional().isString().withMessage('Specialization must be a string'),
  body('hospitalId').optional().isInt().withMessage('Hospital ID must be a number'),
  body('availableTimes').optional().isString().withMessage('Available times must be a string')
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
      name, email, password, phone, specialization, hospitalId, availableTimes
    } = req.body;

    // Check if doctor with same email already exists
    const [existingDoctors] = await pool.execute(
      'SELECT id FROM Doctors WHERE email = ?',
      [email]
    );

    if (existingDoctors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already taken by another doctor'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert doctor profile
    const [result] = await pool.execute(
      `INSERT INTO Doctors (
        name, email, password, phone, specialization, 
        hospital_id, available_times, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [name, email, hashedPassword, phone, specialization, hospitalId, availableTimes]
    );

    const doctorId = result.insertId;

    // Get created doctor
    const [doctors] = await pool.execute(
      'SELECT id, name, email, phone, specialization, hospital_id, available_times, created_at FROM Doctors WHERE id = ?',
      [doctorId]
    );

    res.status(201).json({
      success: true,
      message: 'Doctor profile created successfully',
      data: doctors[0]
    });

  } catch (error) {
    console.error('Create doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create doctor profile'
    });
  }
});

// Update doctor profile
router.put('/:id', [
  authenticateToken,
  authorizeRoles('doctor', 'admin'),
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('specialization').optional().isString().withMessage('Specialization must be a string'),
  body('hospitalId').optional().isInt().withMessage('Hospital ID must be a number'),
  body('availableTimes').optional().isString().withMessage('Available times must be a string')
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

    // Check if doctor exists
    const [doctors] = await pool.execute(
      'SELECT id FROM Doctors WHERE id = ?',
      [id]
    );

    if (doctors.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Check if email is already taken by another doctor
    if (updateData.email) {
      const [existingEmail] = await pool.execute(
        'SELECT id FROM Doctors WHERE email = ? AND id != ?',
        [updateData.email, id]
      );

      if (existingEmail.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken by another doctor'
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
        if (key === 'hospitalId') dbField = 'hospital_id';
        if (key === 'availableTimes') dbField = 'available_times';
        
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

    // Update doctor
    await pool.execute(
      `UPDATE Doctors SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated doctor
    const [updatedDoctors] = await pool.execute(
      'SELECT id, name, email, phone, specialization, hospital_id, available_times, created_at FROM Doctors WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Doctor profile updated successfully',
      data: updatedDoctors[0]
    });

  } catch (error) {
    console.error('Update doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update doctor profile'
    });
  }
});

// Delete doctor profile
router.delete('/:id', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if doctor exists
    const [doctors] = await pool.execute(
      'SELECT id FROM Doctors WHERE id = ?',
      [id]
    );

    if (doctors.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Delete doctor (no soft delete in actual schema)
    await pool.execute(
      'DELETE FROM Doctors WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Doctor profile deleted successfully'
    });

  } catch (error) {
    console.error('Delete doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete doctor profile'
    });
  }
});

// Get doctor specializations
router.get('/specializations/list', async (req, res) => {
  try {
    const [specializations] = await pool.execute(
      'SELECT DISTINCT specialization FROM Doctors WHERE specialization IS NOT NULL AND specialization != "" ORDER BY specialization'
    );

    const specializationList = specializations.map(spec => spec.specialization);

    res.json({
      success: true,
      data: specializationList
    });

  } catch (error) {
    console.error('Get specializations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get specializations'
    });
  }
});

export default router; 