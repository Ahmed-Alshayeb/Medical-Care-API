// Database connection
import connectionDB from "./config/database.js";
connectionDB();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
dotenv.config();

import authRouter from "./routes/auth.js";
import userRouter from "./routes/users.js";
// import doctorRoutes from './routes/doctors.js';
// import hospitalRoutes from './routes/hospitals.js';
// import pharmacyRoutes from './routes/pharmacies.js';
// import labRoutes from './routes/labs.js';
// import appointmentRoutes from './routes/appointments.js';
// import ambulanceRoutes from './routes/ambulance.js';
// import paymentRoutes from './routes/payments.js';
// import eventRoutes from './routes/events.js';
// import clinicRoutes from './routes/clinics.js';
// import aiChatRoutes from './routes/aiChat.js';

const app = express();
const PORT = process.env.SERVER_PORT || 3000;

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan("combined"));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Static files
app.use("/uploads", express.static("uploads"));

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
// app.use('/api/doctors', doctorRoutes);
// app.use('/api/hospitals', hospitalRoutes);
// app.use('/api/pharmacies', pharmacyRoutes);
// app.use('/api/labs', labRoutes);
// app.use('/api/appointments', appointmentRoutes);
// app.use('/api/ambulance', ambulanceRoutes);
// app.use('/api/payments', paymentRoutes);
// app.use('/api/events', eventRoutes);
// app.use('/api/clinics', clinicRoutes);
// app.use('/api/ai-chat', aiChatRoutes);
app.use("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to the Medical Care API",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Globel Error Handling
app.use((err, req, res, next) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Medical Care API server running on port ${PORT}`);
});
