import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all payments (with filters)
router.get('/', [
  authenticateToken,
  query('status').optional().isIn(['pending', 'completed', 'failed', 'cancelled']),
  query('type').optional().isIn(['appointment', 'pharmacy', 'lab', 'ambulance']),
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

    const { status, type, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['1=1'];
    let params = [];

    // Filter by user role
    if (req.user.role === 'patient') {
      whereConditions.push('p.user_id = ?');
      params.push(req.user.id);
    }

    if (status) {
      whereConditions.push('p.status = ?');
      params.push(status);
    }

    if (type) {
      whereConditions.push('p.payment_type = ?');
      params.push(type);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get payments with pagination
    const [payments] = await pool.execute(
      `SELECT 
        p.id, p.user_id, p.amount, p.currency, p.payment_type, p.status,
        p.transaction_id, p.payment_method, p.created_at, p.updated_at,
        u.name as user_name, u.email as user_email
      FROM Payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Payments p WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments'
    });
  }
});

// Get payment by ID
router.get('/:id', [
  authenticateToken
], async (req, res) => {
  try {
    const { id } = req.params;

    const [payments] = await pool.execute(
      `SELECT 
        p.id, p.user_id, p.amount, p.currency, p.payment_type, p.status,
        p.transaction_id, p.payment_method, p.created_at, p.updated_at,
        u.name as user_name, u.email as user_email
      FROM Payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?`,
      [id]
    );

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    const payment = payments[0];

    // Check if user has permission to view this payment
    if (req.user.role === 'patient' && payment.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: payment
    });

  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment'
    });
  }
});

// Create payment
router.post('/', [
  authenticateToken,
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount is required'),
  body('currency').isIn(['USD', 'EUR', 'GBP']).withMessage('Valid currency is required'),
  body('paymentType').isIn(['appointment', 'pharmacy', 'lab', 'ambulance']).withMessage('Valid payment type is required'),
  body('paymentMethod').isIn(['credit_card', 'debit_card', 'bank_transfer', 'cash']).withMessage('Valid payment method is required'),
  body('referenceId').optional().isInt().withMessage('Valid reference ID is required'),
  body('description').optional().isLength({ max: 500 }).withMessage('Description must be less than 500 characters')
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
      amount, currency, paymentType, paymentMethod, referenceId, description
    } = req.body;

    // Generate transaction ID
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create payment
    const [result] = await pool.execute(
      `INSERT INTO Payments (
        user_id, amount, currency, payment_type, payment_method,
        transaction_id, reference_id, description, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [req.user.id, amount, currency, paymentType, paymentMethod, transactionId, referenceId, description]
    );

    const paymentId = result.insertId;

    // Get created payment
    const [payments] = await pool.execute(
      `SELECT 
        p.id, p.user_id, p.amount, p.currency, p.payment_type, p.status,
        p.transaction_id, p.payment_method, p.created_at,
        u.name as user_name, u.email as user_email
      FROM Payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?`,
      [paymentId]
    );

    res.status(201).json({
      success: true,
      message: 'Payment created successfully',
      data: payments[0]
    });

  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment'
    });
  }
});

// Update payment status
router.put('/:id/status', [
  authenticateToken,
  authorizeRoles('admin'),
  body('status').isIn(['pending', 'completed', 'failed', 'cancelled']).withMessage('Valid status is required'),
  body('transactionId').optional().isString().withMessage('Transaction ID is required')
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
    const { status, transactionId } = req.body;

    // Check if payment exists
    const [payments] = await pool.execute(
      'SELECT id FROM Payments WHERE id = ?',
      [id]
    );

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Update payment
    const updateFields = ['status = ?', 'updated_at = NOW()'];
    const updateParams = [status];

    if (transactionId) {
      updateFields.push('transaction_id = ?');
      updateParams.push(transactionId);
    }

    updateParams.push(id);

    await pool.execute(
      `UPDATE Payments SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated payment
    const [updatedPayments] = await pool.execute(
      `SELECT 
        p.id, p.user_id, p.amount, p.currency, p.payment_type, p.status,
        p.transaction_id, p.payment_method, p.created_at, p.updated_at,
        u.name as user_name, u.email as user_email
      FROM Payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Payment status updated successfully',
      data: updatedPayments[0]
    });

  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment'
    });
  }
});

// Get payment statistics
router.get('/stats/overview', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    // Get payment counts by status
    const [statusStats] = await pool.execute(
      `SELECT 
        status,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM Payments
      GROUP BY status`
    );

    // Get payment counts by type
    const [typeStats] = await pool.execute(
      `SELECT 
        payment_type,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM Payments
      GROUP BY payment_type`
    );

    // Get today's payments
    const [todayPayments] = await pool.execute(
      'SELECT COUNT(*) as count, SUM(amount) as total_amount FROM Payments WHERE DATE(created_at) = CURDATE()'
    );

    // Get this month's payments
    const [monthPayments] = await pool.execute(
      'SELECT COUNT(*) as count, SUM(amount) as total_amount FROM Payments WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())'
    );

    res.json({
      success: true,
      data: {
        statusStats,
        typeStats,
        today: {
          count: todayPayments[0].count,
          totalAmount: todayPayments[0].total_amount
        },
        thisMonth: {
          count: monthPayments[0].count,
          totalAmount: monthPayments[0].total_amount
        }
      }
    });

  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment statistics'
    });
  }
});

// Get all payments for a user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [payments] = await pool.execute(
      'SELECT * FROM Payments WHERE user_id = ? ORDER BY payment_date DESC',
      [req.user.id]
    );
    res.json({ success: true, data: payments });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get a single payment by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [payments] = await pool.execute(
      'SELECT * FROM Payments WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (payments.length === 0) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = payments[0];

    // Check if user has permission to view this payment
    if (req.user.role === 'patient' && payment.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: payment
    });

  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment'
    });
  }
});

// Create a new payment
router.post('/', authenticateToken, [
  body('appointment_id').isInt(),
  body('amount').isFloat({ gt: 0 }),
  body('method').notEmpty()
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

    const { appointment_id, amount, method } = req.body;

    try {
      const [result] = await pool.execute(
        'INSERT INTO Payments (user_id, appointment_id, amount, payment_date, status, method, created_at, updated_at) VALUES (?, ?, ?, NOW(), ?, ?, NOW(), NOW())',
        [req.user.id, appointment_id, amount, 'completed', method]
      );
      res.status(201).json({ success: true, message: 'Payment created successfully', data: { id: result.insertId } });
    } catch (error) {
      console.error('Create payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create payment'
      });
    }
  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment'
    });
  }
});

// Update a payment status (for admin)
router.put('/:id/status', [authenticateToken, authorizeRoles('admin')], [
  body('status').isIn(['pending', 'completed', 'failed'])
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

    const { status } = req.body;
    const { id } = req.params;

    try {
      const [result] = await pool.execute(
        'UPDATE Payments SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found'
        });
      }

      res.json({
        success: true,
        message: 'Payment status updated successfully'
      });
    } catch (error) {
      console.error('Update payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update payment'
      });
    }
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment'
    });
  }
});

// Admin: Get all payments
router.get('/admin/all', [authenticateToken, authorizeRoles('admin')], async (req, res) => {
  try {
    const [payments] = await pool.execute('SELECT p.*, u.name as user_name FROM Payments p JOIN Users u ON p.user_id = u.id ORDER BY p.payment_date DESC');
    res.json({ success: true, data: payments });
  } catch (error) {
    console.error('Error fetching all payments:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router; 