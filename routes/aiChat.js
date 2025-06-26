import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { pool } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
// In a real scenario, you would integrate with an actual AI service SDK
// const { getAIChatResponse } = require('../services/aiService'); 

const router = express.Router();

// A mock function to simulate getting a response from an AI model
const getMockAIResponse = async (message) => {
    // In a real implementation, this would call a service like OpenAI, Gemini, etc.
    return `This is a simulated AI response to: "${message}"`;
};

// Get chat history for user
router.get('/history', [
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

    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Get chat history with pagination
    const [messages] = await pool.execute(
      `SELECT 
        id, user_id, message, response, created_at
      FROM ai_chat_messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM ai_chat_messages WHERE user_id = ?',
      [req.user.id]
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    });

  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat history'
    });
  }
});

// POST a new message to the AI chat
router.post('/', authenticateToken, [
    body('message').notEmpty().withMessage('Message cannot be empty.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { message } = req.body;
    const userId = req.user.id;

    try {
        // Get a response from the AI model (mocked here)
        const aiResponse = await getMockAIResponse(message);

        // Save the interaction to the database
        const [result] = await pool.execute(
            'INSERT INTO AIModelInteractions (user_id, prompt, response, created_at) VALUES (?, ?, ?, NOW())',
            [userId, message, aiResponse]
        );

        res.status(201).json({
            success: true,
            message: 'Message processed successfully',
            data: {
                id: result.insertId,
                user_id: userId,
                prompt: message,
                response: aiResponse,
                created_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({ success: false, message: 'Server error during AI chat processing.' });
    }
});

// Clear chat history
router.delete('/history', [
  authenticateToken
], async (req, res) => {
  try {
    // Delete all chat messages for the user
    await pool.execute(
      'DELETE FROM ai_chat_messages WHERE user_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'Chat history cleared successfully'
    });

  } catch (error) {
    console.error('Clear chat history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear chat history'
    });
  }
});

// Get chat statistics
router.get('/stats', [
  authenticateToken
], async (req, res) => {
  try {
    // Get total messages count
    const [totalMessages] = await pool.execute(
      'SELECT COUNT(*) as count FROM ai_chat_messages WHERE user_id = ?',
      [req.user.id]
    );

    // Get today's messages count
    const [todayMessages] = await pool.execute(
      'SELECT COUNT(*) as count FROM ai_chat_messages WHERE user_id = ? AND DATE(created_at) = CURDATE()',
      [req.user.id]
    );

    // Get this week's messages count
    const [weekMessages] = await pool.execute(
      'SELECT COUNT(*) as count FROM ai_chat_messages WHERE user_id = ? AND YEARWEEK(created_at) = YEARWEEK(CURDATE())',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        total: totalMessages[0].count,
        today: todayMessages[0].count,
        thisWeek: weekMessages[0].count
      }
    });

  } catch (error) {
    console.error('Get chat stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat statistics'
    });
  }
});

export default router; 