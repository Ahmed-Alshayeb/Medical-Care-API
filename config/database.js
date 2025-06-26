import { Sequelize } from "sequelize";
import mysql from "mysql2";
import { config } from "dotenv";
config();

export const sequelize = new Sequelize({
  host: "193.203.168.173",
  port: 3306,
  username: "u350616619_medicalApp",
  password: "0bwG8TCD=qY",
  database: "u350616619_medicalApp_DB",
  dialect: "mysql",
  dialectModule: mysql,
});

const connectionDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected...");
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
  }
};

export default connectionDB;
