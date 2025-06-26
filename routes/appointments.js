import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all appointments for the logged-in user (patient or doctor)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query;
    let params = [req.user.id];

    if (req.user.role === 'doctor') {
      query = `
        SELECT a.*, p.name as patient_name, p.phone as patient_phone 
        FROM Appointments a 
        JOIN Users p ON a.patient_id = p.id 
        WHERE a.doctor_id = ?`;
    } else { // patient or admin
      query = `
        SELECT a.*, d.name as doctor_name, d.specialization as doctor_specialization 
        FROM Appointments a 
        JOIN Doctors d ON a.doctor_id = d.id 
        WHERE a.patient_id = ?`;
    }
    
    // Optional filtering by status
    if (req.query.status && ['scheduled', 'completed', 'canceled'].includes(req.query.status)) {
        query += ' AND a.status = ?';
        params.push(req.query.status);
    }
    
    query += ' ORDER BY a.appointment_date DESC';

    const [appointments] = await pool.execute(query, params);
    res.json({ success: true, data: appointments });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointments'
    });
  }
});

// Get appointment by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT a.*, d.name as doctor_name, p.name as patient_name 
      FROM Appointments a 
      JOIN Doctors d ON a.doctor_id = d.id 
      JOIN Users p ON a.patient_id = p.id 
      WHERE a.id = ?`;
    
    const [appointments] = await pool.execute(query, [req.params.id]);

    if (appointments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    const appointment = appointments[0];

    // Check if user has permission to view this appointment
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (req.user.role === 'doctor') {
      const [doctorCheck] = await pool.execute(
        'SELECT id FROM doctors WHERE id = ? AND user_id = ?',
        [appointment.doctor_id, req.user.id]
      );
      if (doctorCheck.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.json({
      success: true,
      data: appointment
    });

  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointment'
    });
  }
});

// Create new appointment
router.post('/', authenticateToken, [
  body('doctor_id').isInt(),
  body('appointment_date').isISO8601().toDate(),
  body('reason').notEmpty()
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

    const { doctor_id, appointment_date, reason } = req.body;
    const patient_id = req.user.id; // User making the appointment is the patient

    // Check if doctor exists and is active
    const [doctors] = await pool.execute(
      'SELECT id, open_hour, close_hour FROM doctors WHERE id = ? AND is_active = 1',
      [doctor_id]
    );

    if (doctors.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    const doctor = doctors[0];

    // Check if appointment date is in the future
    const appointmentDateTime = new Date(`${appointment_date}`);
    const now = new Date();

    if (appointmentDateTime <= now) {
      return res.status(400).json({
        success: false,
        message: 'Appointment must be scheduled for a future date'
      });
    }

    // Check if time is within doctor's working hours
    const appointmentHour = parseInt(appointment_date.split('T')[1].split(':')[0]);
    const openHour = parseInt(doctor.open_hour.split(':')[0]);
    const closeHour = parseInt(doctor.close_hour.split(':')[0]);

    if (appointmentHour < openHour || appointmentHour >= closeHour) {
      return res.status(400).json({
        success: false,
        message: 'Appointment time must be within doctor\'s working hours'
      });
    }

    // Check if time slot is available
    const [existingAppointments] = await pool.execute(
      'SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != "cancelled"',
      [doctor_id, appointment_date]
    );

    if (existingAppointments.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is already booked'
      });
    }

    // Check if patient already has an appointment at this time
    const [patientAppointments] = await pool.execute(
      'SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? AND status != "cancelled"',
      [patient_id, appointment_date]
    );

    if (patientAppointments.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have an appointment at this time'
      });
    }

    // Create appointment
    const [result] = await pool.execute(
      'INSERT INTO Appointments (patient_id, doctor_id, appointment_date, reason, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [patient_id, doctor_id, appointment_date, reason, 'scheduled']
    );

    const appointmentId = result.insertId;

    // Get created appointment
    const [appointments] = await pool.execute(
      `SELECT 
        a.id, a.patient_id, a.doctor_id, a.appointment_date, a.appointment_time,
        a.status, a.notes, a.created_at,
        p.name as patient_name, p.email as patient_email,
        d.name as doctor_name, d.specialization, d.email as doctor_email
      FROM appointments a
      LEFT JOIN users p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ?`,
      [appointmentId]
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: appointments[0]
    });

  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to book appointment'
    });
  }
});

// Update appointment status
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body; // e.g., 'completed', 'canceled'
    if (!status || !['scheduled', 'completed', 'canceled'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status provided."});
    }

    const [result] = await pool.execute(
      'UPDATE Appointments SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.json({ success: true, message: 'Appointment status updated successfully' });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update appointment'
    });
  }
});

// Cancel appointment
router.put('/:id/cancel', [
  authenticateToken,
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Check if appointment exists
    const [appointments] = await pool.execute(
      'SELECT patient_id, doctor_id, status FROM appointments WHERE id = ?',
      [id]
    );

    if (appointments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    const appointment = appointments[0];

    // Check if appointment can be cancelled
    if (appointment.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Appointment is already cancelled'
      });
    }

    if (appointment.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed appointment'
      });
    }

    // Check if user has permission to cancel
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only cancel your own appointments.'
      });
    }

    if (req.user.role === 'doctor') {
      const [doctorCheck] = await pool.execute(
        'SELECT id FROM doctors WHERE id = ? AND user_id = ?',
        [appointment.doctor_id, req.user.id]
      );
      if (doctorCheck.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only cancel your own appointments.'
        });
      }
    }

    // Cancel appointment
    const updateFields = ['status = "cancelled"', 'updated_at = NOW()'];
    const updateParams = [];

    if (reason) {
      updateFields.push('notes = ?');
      updateParams.push(reason);
    }

    updateParams.push(id);

    await pool.execute(
      `UPDATE appointments SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    res.json({
      success: true,
      message: 'Appointment cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel appointment'
    });
  }
});

// Get appointment statistics
router.get('/stats/overview', [
  authenticateToken,
  authorizeRoles('doctor', 'admin')
], async (req, res) => {
  try {
    let whereClause = '1=1';
    let params = [];

    // Filter by doctor if user is a doctor
    if (req.user.role === 'doctor') {
      whereClause += ' AND a.doctor_id IN (SELECT id FROM doctors WHERE user_id = ?)';
      params.push(req.user.id);
    }

    // Get appointment counts by status
    const [statusStats] = await pool.execute(
      `SELECT 
        status,
        COUNT(*) as count
      FROM appointments a
      WHERE ${whereClause}
      GROUP BY status`,
      params
    );

    // Get today's appointments
    const [todayAppointments] = await pool.execute(
      `SELECT COUNT(*) as count FROM appointments a WHERE ${whereClause} AND appointment_date = CURDATE()`,
      params
    );

    // Get this week's appointments
    const [weekAppointments] = await pool.execute(
      `SELECT COUNT(*) as count FROM appointments a WHERE ${whereClause} AND YEARWEEK(appointment_date) = YEARWEEK(CURDATE())`,
      params
    );

    // Get this month's appointments
    const [monthAppointments] = await pool.execute(
      `SELECT COUNT(*) as count FROM appointments a WHERE ${whereClause} AND YEAR(appointment_date) = YEAR(CURDATE()) AND MONTH(appointment_date) = MONTH(CURDATE())`,
      params
    );

    res.json({
      success: true,
      data: {
        statusStats,
        today: todayAppointments[0].count,
        thisWeek: weekAppointments[0].count,
        thisMonth: monthAppointments[0].count
      }
    });

  } catch (error) {
    console.error('Get appointment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointment statistics'
    });
  }
});

// Delete an appointment
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // We will use a hard delete here, but a soft delete (setting a flag) might be better
    const [result] = await pool.execute(
      'DELETE FROM Appointments WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    res.json({ success: true, message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router; 