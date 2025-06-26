import { body, validationResult } from "express-validator";
import { authenticateToken } from "../middleware/auth.js";
import { sequelize } from "../config/database.js";
import jwt from "jsonwebtoken";
import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const authRouter = express.Router();

// @desc    Register user
// @route   POST /api/auth/register
// @Author: A.A
authRouter.post(
  "/register",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Must be a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
    body("phone").notEmpty().withMessage("Phone number is required"),
    body("type").optional().isIn(["patient", "admin"]),
  ],
  async (req, res) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { name, email, password, phone, type } = req.body;

      // Check if user already exists
      const users = await sequelize.query(
        `SELECT email FROM Users WHERE email = ?`,
        {
          replacements: [email],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      if (users.length > 0) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Insert new user
      await sequelize.query(
        `INSERT INTO Users (name, email, password, phone, type, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        {
          replacements: [name, email, hashedPassword, phone, type || "patient"],
        }
      );

      // Get inserted user ID
      const [userInserted] = await sequelize.query(
        "SELECT id FROM Users WHERE email = ?",
        {
          replacements: [email],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: userInserted.id,
          email,
          type: type || "patient",
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Send response
      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          user: {
            id: userInserted.id,
            name,
            email,
            phone,
            type: type || "patient",
          },
          token,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        success: false,
        message: "Registration failed",
        error: error.message,
      });
    }
  }
);

// @desc    Login user
// @route   POST /api/auth/login
// @Author: A.A
authRouter.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;

      // Find user by email
      const [user] = await sequelize.query(
        "SELECT * FROM Users WHERE email = ?",
        {
          replacements: [email],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          type: user.type,
        },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      // Respond
      res.json({
        success: true,
        message: "Login successful",
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            type: user.type,
          },
          token,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Login failed",
        error: error.message,
      });
    }
  }
);

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @Author: A.A
authRouter.get("/profile", authenticateToken, async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      "SELECT id, name, email, phone, type, created_at FROM Users WHERE id = ?",
      {
        replacements: [req.user.userId],
        type: sequelize.QueryTypes.SELECT,
      }
    );

    if (!rows) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get profile",
    });
  }
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @Author: A.A
authRouter.put(
  "/change-password",
  [
    authenticateToken,
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { currentPassword, newPassword } = req.body;

      const [user] = await sequelize.query(
        "SELECT password FROM Users WHERE id = ?",
        {
          replacements: [req.user.userId],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      const hashed = await bcrypt.hash(newPassword, 12);

      await sequelize.query("UPDATE Users SET password = ? WHERE id = ?", {
        replacements: [hashed, req.user.userId],
      });

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to change password",
      });
    }
  }
);

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @Author: A.A
authRouter.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Valid email is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { email } = req.body;

      const [user] = await sequelize.query(
        "SELECT id, name FROM Users WHERE email = ?",
        {
          replacements: [email],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User with this email not found",
        });
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenExpiry = new Date(Date.now() + 3600000);

      // حفظ التوكن في قاعدة البيانات (إذا كنت تستخدم reset_token في جدول المستخدمين)
      // await sequelize.query(
      //   'UPDATE Users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      //   { replacements: [resetToken, resetTokenExpiry, user.id] }
      // );

      res.json({
        success: true,
        message: "Password reset instructions sent to your email",
        data: {
          resetToken,
          resetTokenExpiry,
        },
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process forgot password request",
      });
    }
  }
);

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @Author: A.A
authRouter.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Reset token is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { token, newPassword } = req.body;

      // تحقق من التوكن في قاعدة البيانات (إذا كان مفعلًا)
      const [user] = await sequelize.query(
        "SELECT id FROM Users WHERE reset_token = ? AND reset_token_expiry > NOW()",
        { replacements: [token], type: sequelize.QueryTypes.SELECT }
      );

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, 12);

      // تنفيذ التحديث (لو كان التحقق مفعلًا)
      await sequelize.query(
        "UPDATE Users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?",
        { replacements: [hashedNewPassword, user.id] }
      );

      res.json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset password",
      });
    }
  }
);

export default authRouter;
