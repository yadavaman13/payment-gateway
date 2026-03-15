# MatePeak Payment Gateway

Production-ready Razorpay gateway for MatePeak booking payments.

## Endpoints

### `POST /api/payment/create-order`
Creates a Razorpay order from booking metadata.

Request body:
```json
{
  "amount": 499,
  "bookingId": "booking_uuid",
  "mentorId": "mentor_uuid",
  "sessionType": "one_to_one"
}
```

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
  "bookingId": "booking_uuid"
}
```

### `POST /api/payment/webhook`
Authoritative webhook endpoint for payment state sync.

Handled events:
- `payment.captured`
- `payment.failed`
- `order.paid`

## Hosted Page Flow

Open gateway with query params:

```text
https://payment-gateway-psp4.onrender.com/?amount=<mentor_price>&bookingId=<booking_id>&mentorId=<mentor_id>&sessionType=<service_type>
```

The hosted page:
- Validates `amount > 0` and `bookingId`.
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
  -d '{"amount":499,"bookingId":"booking_uuid","mentorId":"mentor_uuid","sessionType":"one_to_one"}'
```

Verify payment:
```bash
curl -X POST http://localhost:3000/api/payment/verify \
  -H "Content-Type: application/json" \
  -d '{"razorpay_order_id":"order_x","razorpay_payment_id":"pay_x","razorpay_signature":"sig_x","bookingId":"booking_uuid"}'
```

Webhook (signature header required):
```bash
curl -X POST http://localhost:3000/api/payment/webhook \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: <computed_signature>" \
  -d '{"event":"payment.captured","payload":{}}'
```
