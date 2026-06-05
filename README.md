# Afterglow Register Frontend – Backend Connected

This frontend is connected to the Afterglow Register backend API.

## Local URLs

- Frontend: http://localhost:5180
- Backend: http://localhost:5000
- MongoDB: MongoDB Atlas through backend

## Default login

Username: `Afterglow`
Password: `After26`

Make sure you already ran the backend and seeded the admin user:

```bash
npm run seed
```

## How to run frontend

1. Start the backend first:

```bash
cd path/to/afterglow-register-backend
npm run dev
```

2. Open this frontend folder and install packages:

```bash
npm install --registry=https://registry.npmjs.org/
npm run dev
```

3. Open:

```text
http://localhost:5180
```

## API connection

By default the frontend uses:

```text
http://localhost:5000
```

For online deployment, create a `.env` file in the frontend folder:

```env
VITE_API_URL=https://your-render-backend-url.onrender.com
```

Then build/deploy the frontend.

## Included features

- Backend login with JWT
- Events from MongoDB backend
- Participant registration saved to MongoDB
- Email simulation / backend email call after registration
- QR code generation
- QR camera scanner using `html5-qrcode`
- Manual delegate ID check-in
- Auto print after successful check-in
- Badge designer connected to event settings
- Badge background upload through backend upload API
- Print settings: A6, A5, A4, CR80, Event Badge, Custom
- Excel export through backend report endpoint
- Users/staff management with event assignment
- Settings page
- Mobile layout for phones including iPhone 11 size
- Participant image crop before saving

## Important email note

If backend `.env` has:

```env
ENABLE_EMAIL=false
```

emails are simulated and saved in backend email logs. To send real emails, set SMTP values and use:

```env
ENABLE_EMAIL=true
```

## Deployment order

1. Push backend to GitHub.
2. Deploy backend to Render.
3. Add MongoDB Atlas URI to Render environment variables.
4. Test backend URL `/api/health`.
5. Push frontend to GitHub.
6. Deploy frontend.
7. Set `VITE_API_URL` to the Render backend URL.
