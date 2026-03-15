# MatePeak Payment Gateway

Production-ready Razorpay gateway for MatePeak booking payments.

## Endpoints

### `POST /api/payment/create-order`
Creates a Razorpay order from booking metadata.

Request body:
```json
{
  "amount": 1499,
  "bookingId": "b610df01-0f43-4aaf",
  "actualBookingId": "b610df01-0f43-4aaf-8c07-5c19d98450f1",
  "mentorId": "9c16e263-45aa-4f93-88eb-dd62e065618f",
  "sessionType": "oneOnOneSession"
}
```

Notes:
- `actualBookingId` is preferred for canonical reconciliation.
- `canonicalBookingId = actualBookingId || bookingId`.
- At least one booking identifier is required.
- Receipt is generated as a safe string (`<= 40` chars) to satisfy Razorpay constraints.

Response:
```json
{
  "success": true,
  "order": {
    "id": "order_...",
    "amount": 49900,
    "currency": "INR"
  },
  "publicKey": "rzp_live_xxx"
}
```

### `POST /api/payment/verify`
Verifies Razorpay payment signature and marks booking as paid/failed.

Request body:
```json
{
  "razorpay_order_id": "order_...",
  "razorpay_payment_id": "pay_...",
  "razorpay_signature": "...",
  "bookingId": "b610df01-0f43-4aaf",
  "actualBookingId": "b610df01-0f43-4aaf-8c07-5c19d98450f1"
}
```

Verify response includes `canonicalBookingId` for easier debugging.

### `POST /api/payment/webhook`
Authoritative webhook endpoint for payment state sync.

Handled events:
- `payment.captured`
- `payment.failed`
- `order.paid`

## Hosted Page Flow

Open gateway with query params:

```text
https://payment-gateway-psp4.onrender.com/?amount=<mentor_price>&bookingId=<short_booking_id>&actualBookingId=<full_booking_uuid>&mentorId=<mentor_id>&sessionType=<service_type>
```

The hosted page:
- Validates `amount > 0` and at least one booking ID (`actualBookingId || bookingId`).
- Creates order via `/api/payment/create-order`.
- Opens Razorpay checkout.
- Calls `/api/payment/verify` on success.
- Redirects to:
  - success: `${MATEPEAK_APP_URL}/booking-success?bookingId=<id>&payment=success`
  - failed: `${MATEPEAK_APP_URL}/booking-success?bookingId=<id>&payment=failed`

## Environment Variables

Required:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `MATEPEAK_APP_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:
- `PORT` (default 3000)

## Razorpay Webhook Setup

In Razorpay Dashboard:
1. Open Webhooks.
2. Add endpoint: `https://payment-gateway-psp4.onrender.com/api/payment/webhook`
3. Choose events:
   - `payment.captured`
   - `payment.failed`
   - `order.paid`
4. Set secret and match with `RAZORPAY_WEBHOOK_SECRET`.

## Local Setup

```bash
npm install
npm run dev
```

Server runs at `http://localhost:3000`.

Create a clean `.env` with only key-value lines:

```env
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
MATEPEAK_APP_URL=https://your-frontend-domain
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Do not paste CLI commands inside `.env`.

## Sample cURL Commands

Create order:
```bash
curl -X POST http://localhost:3000/api/payment/create-order \
  -H "Content-Type: application/json" \
  -d '{"amount":1499,"bookingId":"b610df01-0f43-4aaf","actualBookingId":"b610df01-0f43-4aaf-8c07-5c19d98450f1","mentorId":"9c16e263-45aa-4f93-88eb-dd62e065618f","sessionType":"oneOnOneSession"}'
```

Create order with short booking ID only (backward compatible):
```bash
curl -X POST http://localhost:3000/api/payment/create-order \
  -H "Content-Type: application/json" \
  -d '{"amount":1499,"bookingId":"b610df01-0f43-4aaf","mentorId":"9c16e263-45aa-4f93-88eb-dd62e065618f","sessionType":"oneOnOneSession"}'
```

Verify payment:
```bash
curl -X POST http://localhost:3000/api/payment/verify \
  -H "Content-Type: application/json" \
  -d '{"razorpay_order_id":"order_x","razorpay_payment_id":"pay_x","razorpay_signature":"sig_x","bookingId":"b610df01-0f43-4aaf","actualBookingId":"b610df01-0f43-4aaf-8c07-5c19d98450f1"}'
```

Webhook (signature header required):
```bash
curl -X POST http://localhost:3000/api/payment/webhook \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: <computed_signature>" \
  -d '{"event":"payment.captured","payload":{}}'
```

Sanity checks:
```bash
npm run sanity:payment
```

This validates canonical booking resolution and ensures generated receipt length always remains `<= 40`.
