import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all ambulance services with filters
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
      whereConditions.push('(a.location LIKE ?)');
      params.push(`%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get ambulance services with pagination
    const [ambulances] = await pool.execute(
      `SELECT 
        a.id, a.location, a.contact_number, a.availability_status, a.created_at
      FROM Ambulances a
      WHERE ${whereClause}
      ORDER BY a.location ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Ambulances a WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        ambulances,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get ambulances error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ambulance services'
    });
  }
});

// Get ambulance by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [ambulances] = await pool.execute(
      `SELECT 
        a.id, a.location, a.contact_number, a.availability_status, a.created_at
      FROM Ambulances a
      WHERE a.id = ?`,
      [id]
    );

    if (ambulances.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ambulance service not found'
      });
    }

    const ambulance = ambulances[0];

    res.json({
      success: true,
      data: ambulance
    });

  } catch (error) {
    console.error('Get ambulance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ambulance service'
    });
  }
});

// Create ambulance service
router.post('/', [
  authenticateToken,
  authorizeRoles('admin'),
  body('location').isLength({ max: 500 }).withMessage('Location must be less than 500 characters'),
  body('contactNumber').isMobilePhone().withMessage('Valid contact number is required'),
  body('availabilityStatus').optional().isIn(['available', 'busy']).withMessage('Valid availability status is required')
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
      location, contactNumber, availabilityStatus
    } = req.body;

    // Insert ambulance service
    const [result] = await pool.execute(
      `INSERT INTO Ambulances (
        location, contact_number, availability_status, created_at
      ) VALUES (?, ?, ?, NOW())`,
      [location, contactNumber, availabilityStatus || 'available']
    );

    const ambulanceId = result.insertId;

    // Get created ambulance service
    const [ambulances] = await pool.execute(
      'SELECT * FROM Ambulances WHERE id = ?',
      [ambulanceId]
    );

    res.status(201).json({
      success: true,
      message: 'Ambulance service created successfully',
      data: ambulances[0]
    });

  } catch (error) {
    console.error('Create ambulance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create ambulance service'
    });
  }
});

// Update ambulance service
router.put('/:id', [
  authenticateToken,
  authorizeRoles('admin'),
  body('location').optional().isLength({ max: 500 }).withMessage('Location must be less than 500 characters'),
  body('contactNumber').optional().isMobilePhone().withMessage('Valid contact number is required'),
  body('availabilityStatus').optional().isIn(['available', 'busy']).withMessage('Valid availability status is required')
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

    // Check if ambulance service exists
    const [ambulances] = await pool.execute(
      'SELECT id FROM Ambulances WHERE id = ?',
      [id]
    );

    if (ambulances.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ambulance service not found'
      });
    }

    // Build update query
    const updateFields = [];
    const updateParams = [];

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && updateData[key] !== null) {
        // Map frontend field names to database column names
        let dbField = key;
        if (key === 'contactNumber') dbField = 'contact_number';
        if (key === 'availabilityStatus') dbField = 'availability_status';
        
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

    // Update ambulance service
    await pool.execute(
      `UPDATE Ambulances SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated ambulance service
    const [updatedAmbulances] = await pool.execute(
      'SELECT * FROM Ambulances WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Ambulance service updated successfully',
      data: updatedAmbulances[0]
    });

  } catch (error) {
    console.error('Update ambulance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update ambulance service'
    });
  }
});

// Delete ambulance service
router.delete('/:id', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ambulance service exists
    const [ambulances] = await pool.execute(
      'SELECT id FROM Ambulances WHERE id = ?',
      [id]
    );

    if (ambulances.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ambulance service not found'
      });
    }

    // Delete ambulance service (no soft delete in actual schema)
    await pool.execute(
      'DELETE FROM Ambulances WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Ambulance service deleted successfully'
    });

  } catch (error) {
    console.error('Delete ambulance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete ambulance service'
    });
  }
});

// Request ambulance
router.post('/request', [
  authenticateToken,
  body('ambulanceId').isInt().withMessage('Ambulance ID is required'),
  body('pickupAddress').isLength({ max: 500 }).withMessage('Pickup address must be less than 500 characters'),
  body('destinationAddress').optional().isLength({ max: 500 }).withMessage('Destination address must be less than 500 characters'),
  body('emergencyType').isIn(['medical', 'accident', 'other']).withMessage('Valid emergency type is required'),
  body('patientName').trim().isLength({ min: 2 }).withMessage('Patient name must be at least 2 characters'),
  body('patientPhone').isMobilePhone().withMessage('Valid patient phone number is required'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes must be less than 500 characters')
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
      ambulanceId, pickupAddress, destinationAddress, emergencyType,
      patientName, patientPhone, notes
    } = req.body;

    // Check if ambulance service exists
    const [ambulances] = await pool.execute(
      'SELECT id, location, contact_number FROM Ambulances WHERE id = ?',
      [ambulanceId]
    );

    if (ambulances.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ambulance service not found'
      });
    }

    // Check if ambulance is available
    const [availableAmbulances] = await pool.execute(
      'SELECT availability_status FROM Ambulances WHERE id = ?',
      [ambulanceId]
    );

    if (availableAmbulances[0].availability_status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'Ambulance is not available at the moment'
      });
    }

    // Create ambulance request
    const [result] = await pool.execute(
      `INSERT INTO AmbulanceRequests (
        user_id, ambulance_id, request_time, status
      ) VALUES (?, ?, NOW(), 'requested')`,
      [req.user.userId, ambulanceId]
    );

    const requestId = result.insertId;

    // Update ambulance availability status
    await pool.execute(
      'UPDATE Ambulances SET availability_status = "busy" WHERE id = ?',
      [ambulanceId]
    );

    // Get created request
    const [requests] = await pool.execute(
      `SELECT 
        ar.id, ar.request_time, ar.status,
        a.location as ambulance_location, a.contact_number as ambulance_contact
      FROM AmbulanceRequests ar
      LEFT JOIN Ambulances a ON ar.ambulance_id = a.id
      WHERE ar.id = ?`,
      [requestId]
    );

    res.status(201).json({
      success: true,
      message: 'Ambulance request created successfully',
      data: requests[0]
    });

  } catch (error) {
    console.error('Create ambulance request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create ambulance request'
    });
  }
});

// Get user's ambulance requests
router.get('/requests/my', [
  authenticateToken,
  query('status').optional().isIn(['requested', 'completed', 'cancelled']),
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

    const { status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['ar.user_id = ?'];
    let params = [req.user.userId];

    if (status) {
      whereConditions.push('ar.status = ?');
      params.push(status);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get requests with pagination
    const [requests] = await pool.execute(
      `SELECT 
        ar.id, ar.request_time, ar.status,
        a.location as ambulance_location, a.contact_number as ambulance_contact
      FROM AmbulanceRequests ar
      LEFT JOIN Ambulances a ON ar.ambulance_id = a.id
      WHERE ${whereClause}
      ORDER BY ar.request_time DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM AmbulanceRequests ar WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get ambulance requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ambulance requests'
    });
  }
});

// Update ambulance request status
router.put('/requests/:id/status', [
  authenticateToken,
  authorizeRoles('admin'),
  body('status').isIn(['requested', 'completed', 'cancelled']).withMessage('Valid status is required')
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
    const { status } = req.body;

    // Check if request exists
    const [requests] = await pool.execute(
      'SELECT ambulance_id, status FROM AmbulanceRequests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ambulance request not found'
      });
    }

    const request = requests[0];

    // Update request
    await pool.execute(
      'UPDATE AmbulanceRequests SET status = ? WHERE id = ?',
      [status, id]
    );

    // If request is cancelled or completed, make ambulance available again
    if (status === 'cancelled' || status === 'completed') {
      await pool.execute(
        'UPDATE Ambulances SET availability_status = "available" WHERE id = ?',
        [request.ambulance_id]
      );
    }

    res.json({
      success: true,
      message: 'Ambulance request status updated successfully'
    });

  } catch (error) {
    console.error('Update ambulance request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update ambulance request'
    });
  }
});

export default router; 