import express from "express";
import { body, validationResult, query } from "express-validator";
import { sequelize } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";

const userRouter = express.Router();

// @desc    Get all users
// @route   GET /api/users
// @Author: A.A
userRouter.get(
  "/",
  [
    query("search").optional().isString(),
    query("type").optional().isIn(["user", "doctor", "admin"]),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
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

      const { search, type, page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      let whereClause = "1=1";
      const replacements = [];

      if (search) {
        whereClause +=
          " AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)";
        replacements.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (type) {
        whereClause += " AND u.type = ?";
        replacements.push(type);
      }

      const users = await sequelize.query(
        `SELECT u.id, u.name, u.email, u.phone, u.type, u.created_at
         FROM Users u
         WHERE ${whereClause}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        {
          replacements: [...replacements, parseInt(limit), offset],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      const countResult = await sequelize.query(
        `SELECT COUNT(*) as total FROM Users u WHERE ${whereClause}`,
        {
          replacements,
          type: sequelize.QueryTypes.SELECT,
        }
      );

      const total = countResult[0]?.total || 0;
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages,
          },
        },
      });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get users",
      });
    }
  }
);

// @desc    Get user by id
// @route   GET /api/users/:id
// @Author: A.A
userRouter.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // // تأكد من وجود req.user
    // if (!req.user) {
    //   return res.status(401).json({
    //     success: false,
    //     message: "Unauthorized: User not authenticated",
    //   });
    // }

    // // صلاحيات الوصول: فقط المدير أو المستخدم نفسه
    // if (req.user.type !== "admin" && req.user.userId !== parseInt(id)) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Access denied",
    //   });
    // }

    const user = await sequelize.query(
      `SELECT u.id, u.name, u.email, u.phone, u.type, u.created_at
       FROM Users u WHERE u.id = ?`,
      {
        replacements: [id],
        type: sequelize.QueryTypes.SELECT,
      }
    );

    if (user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, data: user[0] });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ success: false, message: "Failed to get user" });
  }
});

// @desc    Get current user profile
// @route   GET /api/auth/profile/me
// @Author: A.A
userRouter.get("/profile/me", authenticateToken, async (req, res) => {
  try {
    const [users] = await sequelize.query(
      `SELECT u.id, u.name, u.email, u.phone, u.type, u.created_at FROM Users u WHERE u.id = ?`,
      { replacements: [req.user.userId], type: sequelize.QueryTypes.SELECT }
    );

    if (users.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, message: "Failed to get profile" });
  }
});

// @desc    Update current user profile
// @route   PUT /api/auth/profile/me
// @Author: A.A
userRouter.put(
  "/profile/me",
  [
    authenticateToken,
    body("name").optional().trim().isLength({ min: 2 }),
    body("phone").optional().isMobilePhone(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });

      const updateData = req.body;
      const updateFields = [];
      const updateValues = [];

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined && updateData[key] !== null) {
          updateFields.push(`${key} = ?`);
          updateValues.push(updateData[key]);
        }
      });

      if (updateFields.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "No valid fields to update" });

      updateValues.push(req.user.userId);

      await sequelize.query(
        `UPDATE Users SET ${updateFields.join(", ")} WHERE id = ?`,
        { replacements: updateValues }
      );

      const [updated] = await sequelize.query(
        "SELECT id, name, email, phone, type, created_at FROM Users WHERE id = ?",
        { replacements: [req.user.userId], type: sequelize.QueryTypes.SELECT }
      );

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: updated[0],
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to update profile" });
    }
  }
);

// @desc    Update user by id
// @route   PUT /api/users/:id
// @Author: A.A
userRouter.put(
  "/:id",
  [
    authenticateToken,
    body("name").optional().trim().isLength({ min: 2 }),
    body("email").optional().isEmail().normalizeEmail(),
    body("phone").optional().isMobilePhone(),
    body("type").optional().isIn(["user", "doctor", "admin"]),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res.status(400).json({
          success: false,
          message: "Validation errors",
          errors: errors.array(),
        });

      const { id } = req.params;
      const updateData = req.body;

      const [existing] = await sequelize.query(
        "SELECT id FROM Users WHERE id = ?",
        {
          replacements: [id],
          type: sequelize.QueryTypes.SELECT,
        }
      );

      if (!existing)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      if (updateData.email) {
        const [existingEmail] = await sequelize.query(
          "SELECT id FROM Users WHERE email = ? AND id != ?",
          {
            replacements: [updateData.email, id],
            type: sequelize.QueryTypes.SELECT,
          }
        );
        if (existingEmail)
          return res
            .status(400)
            .json({ success: false, message: "Email is already taken" });
      }

      const updateFields = [];
      const updateValues = [];

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined && updateData[key] !== null) {
          updateFields.push(`${key} = ?`);
          updateValues.push(updateData[key]);
        }
      });

      if (updateFields.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "No valid fields to update" });

      updateValues.push(id);

      await sequelize.query(
        `UPDATE Users SET ${updateFields.join(", ")} WHERE id = ?`,
        {
          replacements: updateValues,
        }
      );

      const [updated] = await sequelize.query(
        "SELECT id, name, email, phone, type, created_at FROM Users WHERE id = ?",
        { replacements: [id], type: sequelize.QueryTypes.SELECT }
      );

      res.json({
        success: true,
        message: "User updated successfully",
        data: updated[0],
      });
    } catch (error) {
      console.error("Update user error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to update user" });
    }
  }
);

// @desc    Delete user by id
// @route   DELETE /api/users/:id
// @Author: A.A
userRouter.delete("/:id", [authenticateToken], async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.userId)
      return res
        .status(400)
        .json({ success: false, message: "Cannot delete your own account" });

    const [user] = await sequelize.query("SELECT id FROM Users WHERE id = ?", {
      replacements: [id],
      type: sequelize.QueryTypes.SELECT,
    });

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    await sequelize.query("DELETE FROM Users WHERE id = ?", {
      replacements: [id],
    });

    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ success: false, message: "Failed to delete user" });
  }
});

// @desc    Get user statistics
// @route   GET /api/users/stats/overview
// @Author: A.A
userRouter.get("/stats/overview", [authenticateToken], async (req, res) => {
  try {
    const [[{ total }]] = await sequelize.query(
      "SELECT COUNT(*) as total FROM Users",
      { type: sequelize.QueryTypes.SELECT }
    );

    const [byType] = await sequelize.query(
      "SELECT type, COUNT(*) as count FROM Users GROUP BY type",
      { type: sequelize.QueryTypes.SELECT }
    );

    const [[{ count: recent }]] = await sequelize.query(
      "SELECT COUNT(*) as count FROM Users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
      { type: sequelize.QueryTypes.SELECT }
    );

    res.json({ success: true, data: { total, byType, recent } });
  } catch (error) {
    console.error("Get user stats error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to get user statistics" });
  }
});

export default userRouter;
