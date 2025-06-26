import jwt from "jsonwebtoken";
import { sequelize } from "../config/database.js";
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    4;
    const token = authHeader.split(" ")[2]; // ✅ التعديل هنا
    console.log(token);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [user] = await sequelize.query(
      "SELECT id, email, name, type FROM Users WHERE id = ?",
      {
        replacements: [decoded.userId],
        type: sequelize.QueryTypes.SELECT,
      }
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      type: user.type,
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
        error,
      });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired",
      });
    }
    console.error("Authentication error:", error);
    return res.status(500).json({
      success: false,
      message: "Authentication error",
    });
  }
};

export { authenticateToken };
