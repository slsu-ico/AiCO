# ICO Services Messenger Chatbot

Facebook Messenger chatbot trial for Southern Luzon State University ICO services listed in the ICO Citizen's Charter 2026.

## What It Does

- Asks whether the requester is an SLSU internal unit/office or an external partner.
- Shows the relevant ICO services for that requester type.
- Provides step-by-step service guides from the Citizen's Charter.
- Handles free-text questions by matching them to the closest service record.
- Hands off safely when the question is outside the charter or needs staff judgment.

## Requirements

- Node.js 24 or newer
- A Meta app with Messenger configured
- A Facebook Page access token
- A public HTTPS deployment URL for live Messenger testing

## Local Setup

```powershell
npm test
```

```powershell
Copy-Item .env.example .env
```

Set these values in your environment before running live:

- `PORT`
- `MESSENGER_VERIFY_TOKEN`
- `PAGE_ACCESS_TOKEN`

Start the webhook server:

```powershell
npm start
```

The Messenger webhook callback path is:

```text
/webhook
```

## Meta Messenger Setup

1. Create or open a Meta app.
2. Add Messenger to the app.
3. Generate a Page Access Token for the Facebook Page.
4. Deploy this app to a public HTTPS host.
5. Set the webhook callback URL to `https://your-domain.example/webhook`.
6. Use the same verify token as `MESSENGER_VERIFY_TOKEN`.
7. Subscribe the Page to message events.
8. Send a test message to the Page.

## Development

Run all tests:

```powershell
npm test
```

Run the server:

```powershell
npm start
```

## Notes

The chatbot does not replace official ICO Job Order forms. It guides users to the correct service information and official request links.
