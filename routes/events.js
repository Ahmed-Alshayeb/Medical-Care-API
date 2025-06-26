import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Get all events with filters
router.get('/', [
  query('search').optional().isString(),
  query('category').optional().isString(),
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

    const { search, category, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['e.is_active = 1'];
    let params = [];

    if (search) {
      whereConditions.push('(e.title LIKE ? OR e.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category) {
      whereConditions.push('e.category = ?');
      params.push(category);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get events with pagination
    const [events] = await pool.execute(
      `SELECT 
        e.id, e.title, e.description, e.category, e.event_date, e.event_time,
        e.location, e.image, e.max_participants, e.current_participants, e.created_at
      FROM Events e
      WHERE ${whereClause}
      ORDER BY e.event_date ASC, e.event_time ASC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM Events e WHERE ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        events,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get events'
    });
  }
});

// Get event by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [events] = await pool.execute(
      `SELECT 
        e.id, e.title, e.description, e.category, e.event_date, e.event_time,
        e.location, e.image, e.max_participants, e.current_participants, e.created_at
      FROM Events e
      WHERE e.id = ? AND e.is_active = 1`,
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Get event participants
    const [participants] = await pool.execute(
      `SELECT 
        ep.id, ep.user_id, ep.created_at,
        u.name as user_name, u.email as user_email
      FROM EventParticipants ep
      LEFT JOIN Users u ON ep.user_id = u.id
      WHERE ep.event_id = ?
      ORDER BY ep.created_at ASC`,
      [id]
    );

    const event = events[0];
    event.participants = participants;

    res.json({
      success: true,
      data: event
    });

  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get event'
    });
  }
});

// Create event
router.post('/', [
  authenticateToken,
  authorizeRoles('admin'),
  body('title').trim().isLength({ min: 2 }).withMessage('Title must be at least 2 characters'),
  body('description').isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('category').isIn(['conference', 'workshop', 'seminar', 'webinar', 'other']).withMessage('Valid category is required'),
  body('eventDate').isDate().withMessage('Valid event date is required'),
  body('eventTime').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('location').isLength({ max: 500 }).withMessage('Location must be less than 500 characters'),
  body('image').optional().isURL().withMessage('Valid image URL is required'),
  body('maxParticipants').isInt({ min: 1 }).withMessage('Max participants must be at least 1')
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
      title, description, category, eventDate, eventTime, location, image, maxParticipants
    } = req.body;

    // Check if event date is in the future
    const eventDateTime = new Date(`${eventDate} ${eventTime}`);
    const now = new Date();

    if (eventDateTime <= now) {
      return res.status(400).json({
        success: false,
        message: 'Event must be scheduled for a future date and time'
      });
    }

    // Insert event
    const [result] = await pool.execute(
      `INSERT INTO Events (
        title, description, category, event_date, event_time, location,
        image, max_participants, current_participants, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
      [title, description, category, eventDate, eventTime, location, image, maxParticipants]
    );

    const eventId = result.insertId;

    // Get created event
    const [events] = await pool.execute(
      'SELECT * FROM Events WHERE id = ?',
      [eventId]
    );

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: events[0]
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create event'
    });
  }
});

// Update event
router.put('/:id', [
  authenticateToken,
  authorizeRoles('admin'),
  body('title').optional().trim().isLength({ min: 2 }).withMessage('Title must be at least 2 characters'),
  body('description').optional().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('category').optional().isIn(['conference', 'workshop', 'seminar', 'webinar', 'other']).withMessage('Valid category is required'),
  body('eventDate').optional().isDate().withMessage('Valid event date is required'),
  body('eventTime').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('location').optional().isLength({ max: 500 }).withMessage('Location must be less than 500 characters'),
  body('image').optional().isURL().withMessage('Valid image URL is required'),
  body('maxParticipants').optional().isInt({ min: 1 }).withMessage('Max participants must be at least 1')
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

    // Check if event exists
    const [events] = await pool.execute(
      'SELECT id FROM Events WHERE id = ?',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if event date is in the future
    if (updateData.eventDate && updateData.eventTime) {
      const eventDateTime = new Date(`${updateData.eventDate} ${updateData.eventTime}`);
      const now = new Date();

      if (eventDateTime <= now) {
        return res.status(400).json({
          success: false,
          message: 'Event must be scheduled for a future date and time'
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

    updateFields.push('updated_at = NOW()');
    updateParams.push(id);

    // Update event
    await pool.execute(
      `UPDATE Events SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated event
    const [updatedEvents] = await pool.execute(
      'SELECT * FROM Events WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Event updated successfully',
      data: updatedEvents[0]
    });

  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update event'
    });
  }
});

// Delete event
router.delete('/:id', [
  authenticateToken,
  authorizeRoles('admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists
    const [events] = await pool.execute(
      'SELECT id FROM Events WHERE id = ?',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Soft delete - set is_active to 0
    await pool.execute(
      'UPDATE Events SET is_active = 0, updated_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete event'
    });
  }
});

// Join event
router.post('/:id/join', [
  authenticateToken
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists and is active
    const [events] = await pool.execute(
      'SELECT id, max_participants, current_participants FROM Events WHERE id = ? AND is_active = 1',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const event = events[0];

    // Check if event is full
    if (event.current_participants >= event.max_participants) {
      return res.status(400).json({
        success: false,
        message: 'Event is full'
      });
    }

    // Check if user is already registered
    const [participants] = await pool.execute(
      'SELECT id FROM EventParticipants WHERE event_id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (participants.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You are already registered for this event'
      });
    }

    // Join event
    await pool.execute(
      'INSERT INTO EventParticipants (event_id, user_id, created_at) VALUES (?, ?, NOW())',
      [id, req.user.id]
    );

    // Update participant count
    await pool.execute(
      'UPDATE Events SET current_participants = current_participants + 1 WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Successfully joined the event'
    });

  } catch (error) {
    console.error('Join event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join event'
    });
  }
});

// Leave event
router.delete('/:id/leave', [
  authenticateToken
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is registered for the event
    const [participants] = await pool.execute(
      'SELECT id FROM EventParticipants WHERE event_id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (participants.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You are not registered for this event'
      });
    }

    // Leave event
    await pool.execute(
      'DELETE FROM EventParticipants WHERE event_id = ? AND user_id = ?',
      [id, req.user.id]
    );

    // Update participant count
    await pool.execute(
      'UPDATE Events SET current_participants = current_participants - 1 WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Successfully left the event'
    });

  } catch (error) {
    console.error('Leave event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave event'
    });
  }
});

// Get user's events
router.get('/my/events', [
  authenticateToken,
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

    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Get user's events with pagination
    const [events] = await pool.execute(
      `SELECT 
        e.id, e.title, e.description, e.category, e.event_date, e.event_time,
        e.location, e.image, e.max_participants, e.current_participants, e.created_at,
        ep.created_at as joined_at
      FROM events e
      INNER JOIN EventParticipants ep ON e.id = ep.event_id
      WHERE ep.user_id = ? AND e.is_active = 1
      ORDER BY e.event_date ASC, e.event_time ASC
      LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM EventParticipants ep INNER JOIN events e ON ep.event_id = e.id WHERE ep.user_id = ? AND e.is_active = 1',
      [req.user.id]
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        events,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get user events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user events'
    });
  }
});

// Get event categories
router.get('/categories/list', async (req, res) => {
  try {
    const [categories] = await pool.execute(
      'SELECT DISTINCT category FROM Events WHERE is_active = 1 ORDER BY category'
    );
    res.json({
      success: true,
      data: categories.map(row => row.category)
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories'
    });
  }
});

export default router; 