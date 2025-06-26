# Medical Care API Backend

A comprehensive RESTful API backend for the Medical Care Flutter application, built with Node.js, Express, and MySQL.

## Features

- **User Authentication & Authorization**: JWT-based authentication with role-based access control
- **Doctor Management**: Doctor profiles, specializations, and availability
- **Hospital Services**: Hospital listings, departments, and doctor associations
- **Pharmacy Services**: Pharmacy management with services and inventory
- **Laboratory Services**: Lab management with tests and results
- **Ambulance Services**: Emergency ambulance requests and tracking
- **Appointment System**: Appointment booking, management, and notifications
- **Payment Processing**: Multiple payment methods and transaction tracking
- **Events & Campaigns**: Medical events, registration, and participation
- **AI Chat Support**: Chat history management (ready for AI integration)
- **User Profiles**: Medical history and family management

## Prerequisites

- Node.js (v14 or higher)
- MySQL (v8.0 or higher)
- npm or yarn

## Installation

1. **Clone the repository and navigate to the API directory**
   ```bash
   cd api
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   - Ensure MySQL is running
   - Create a database or use the existing one
   - Run the database schema:
   ```bash
   mysql -u your_username -p < database_schema.sql
   ```

4. **Configure environment variables**
   - Copy `config.env` to `.env` in the api directory
   - Update the values according to your setup:
   ```env
   DB_HOST=localhost
   DB_USER=medicalcareall
   DB_PASS=tN2SQ0VVOAhd
   DB_NAME=medicalcare_medicalcare_database_sql
   JWT_SECRET=d691a2d924d38287b699ce1d3023315dff85839b10e5424f02f9db79e59f6a3b
   SERVER_PORT=3000
   NODE_ENV=development
   ```

5. **Start the server**
   ```bash
   npm start
   ```

   For development with auto-restart:
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user profile
- `PUT /api/auth/change-password` - Change password
- `POST /api/auth/forgot-password` - Forgot password
- `POST /api/auth/reset-password` - Reset password

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `GET /api/users` - Get all users (admin only)
- `GET /api/users/:id` - Get user by ID (admin only)
- `PUT /api/users/:id` - Update user (admin only)
- `DELETE /api/users/:id` - Delete user (admin only)

### Doctors
- `GET /api/doctors` - Get all doctors with filters
- `GET /api/doctors/:id` - Get doctor by ID
- `POST /api/doctors` - Create doctor profile
- `PUT /api/doctors/:id` - Update doctor profile
- `DELETE /api/doctors/:id` - Delete doctor profile
- `GET /api/doctors/:id/available-appointments` - Get available appointments
- `GET /api/doctors/specializations/list` - Get specializations list

### Appointments
- `GET /api/appointments` - Get appointments with filters
- `GET /api/appointments/:id` - Get appointment by ID
- `POST /api/appointments` - Create appointment
- `PUT /api/appointments/:id/status` - Update appointment status
- `PUT /api/appointments/:id/cancel` - Cancel appointment
- `GET /api/appointments/stats/overview` - Get appointment statistics

### Hospitals
- `GET /api/hospitals` - Get all hospitals with filters
- `GET /api/hospitals/:id` - Get hospital by ID
- `POST /api/hospitals` - Create hospital (admin only)
- `PUT /api/hospitals/:id` - Update hospital (admin only)
- `DELETE /api/hospitals/:id` - Delete hospital (admin only)
- `GET /api/hospitals/:id/departments` - Get hospital departments
- `GET /api/hospitals/:id/doctors` - Get hospital doctors
- `GET /api/hospitals/cities/list` - Get cities with hospitals

### Pharmacies
- `GET /api/pharmacies` - Get all pharmacies with filters
- `GET /api/pharmacies/:id` - Get pharmacy by ID
- `POST /api/pharmacies` - Create pharmacy (admin only)
- `PUT /api/pharmacies/:id` - Update pharmacy (admin only)
- `DELETE /api/pharmacies/:id` - Delete pharmacy (admin only)
- `GET /api/pharmacies/:id/services` - Get pharmacy services
- `GET /api/pharmacies/cities/list` - Get cities with pharmacies

### Labs
- `GET /api/labs` - Get all labs with filters
- `GET /api/labs/:id` - Get lab by ID
- `POST /api/labs` - Create lab (admin only)
- `PUT /api/labs/:id` - Update lab (admin only)
- `DELETE /api/labs/:id` - Delete lab (admin only)
- `GET /api/labs/:id/tests` - Get lab tests
- `GET /api/labs/cities/list` - Get cities with labs

### Ambulance
- `GET /api/ambulance` - Get all ambulance services with filters
- `GET /api/ambulance/:id` - Get ambulance by ID
- `POST /api/ambulance` - Create ambulance service (admin only)
- `PUT /api/ambulance/:id` - Update ambulance service (admin only)
- `DELETE /api/ambulance/:id` - Delete ambulance service (admin only)
- `POST /api/ambulance/request` - Request ambulance
- `GET /api/ambulance/requests/my` - Get user's ambulance requests
- `PUT /api/ambulance/requests/:id/status` - Update request status (admin only)
- `GET /api/ambulance/cities/list` - Get cities with ambulance services

### Payments
- `GET /api/payments` - Get payments with filters
- `GET /api/payments/:id` - Get payment by ID
- `POST /api/payments` - Create payment
- `PUT /api/payments/:id/status` - Update payment status (admin only)
- `GET /api/payments/stats/overview` - Get payment statistics (admin only)

### Events
- `GET /api/events` - Get all events with filters
- `GET /api/events/:id` - Get event by ID
- `POST /api/events` - Create event (admin only)
- `PUT /api/events/:id` - Update event (admin only)
- `DELETE /api/events/:id` - Delete event (admin only)
- `POST /api/events/:id/join` - Join event
- `DELETE /api/events/:id/leave` - Leave event
- `GET /api/events/my/events` - Get user's events
- `GET /api/events/categories/list` - Get event categories

### Clinics
- `GET /api/clinics` - Get all clinics with filters

### AI Chat
- `GET /api/ai-chat/history` - Get chat history
- `POST /api/ai-chat/send` - Send message to AI
- `DELETE /api/ai-chat/history` - Clear chat history
- `GET /api/ai-chat/stats` - Get chat statistics

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Response Format

All API responses follow a consistent format:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    // Response data
  }
}
```

Error responses:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    // Validation errors (if any)
  ]
}
```

## Database Schema

The database includes the following main tables:
- `users` - User accounts and authentication
- `doctors` - Doctor profiles and information
- `hospitals` - Hospital information
- `pharmacies` - Pharmacy information
- `labs` - Laboratory information
- `ambulances` - Ambulance services
- `appointments` - Appointment bookings
- `payments` - Payment transactions
- `events` - Medical events and campaigns
- `clinics` - Medical clinics
- `ai_chat_messages` - AI chat history

## Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Role-based access control
- Input validation and sanitization
- Rate limiting
- CORS configuration
- Helmet security headers

## Development

### Running in Development Mode
```bash
npm run dev
```

### Testing
```bash
npm test
```

### Health Check
Visit `http://localhost:3000/health` to check if the API is running.

## Flutter Integration

Update your Flutter app's API base URL to point to your backend:

```dart
const String baseUrl = 'http://173.249.38.134:3000/api';
```

## Production Deployment

1. Set `NODE_ENV=production` in your environment variables
2. Use a process manager like PM2
3. Set up a reverse proxy (nginx)
4. Configure SSL certificates
5. Set up proper database backups

## Sample Admin Credentials

The database includes a sample admin user:
- Email: `admin@medicalcare.com`
- Password: `admin123`

**Note**: Change these credentials in production!

## Support

For issues and questions, please refer to the API documentation or contact the development team. #   M e d i c a l - C a r e - A P I  
 