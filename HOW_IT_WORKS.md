# Neomora Club Manager — How It Works

A plain-English guide to how the system works for clubs, parents, and
staff. No technical jargon — just real-world stories of what the
system does for you.

---

## What is Neomora Club Manager?

Neomora is the complete behind-the-scenes operating system for your
club. It handles **every step** of running a club — from the moment
a parent scans a QR code at your branch, all the way to the day their
child completes the programme.

Think of it as having a tireless office assistant who:

- 📋 Registers new families
- 📅 Manages class schedules and seat availability
- 📄 Collects and verifies required documents
- 💰 Sends invoices and tracks payments
- 📱 Messages parents at the right moments (WhatsApp, email, SMS)
- 📊 Gives your managers live dashboards of what's happening
- 🔒 Keeps an audit trail of every change for total transparency

The system runs **24/7** — even at 3 AM, parents can register their
kids, pay invoices, or join the waitlist without waiting for office
hours.

---

## The People Who Use the System

The system serves **three audiences**, each with their own experience:

### 👨‍👩‍👧 Parents & Guardians
The families enrolling their children. They never need to install
anything — everything happens through links sent to their phone
(WhatsApp / email) or by scanning a QR code at your branch.

### 🧑‍💼 Your Staff Team
Your branch managers, front-desk staff, and finance team. They log
in to a web dashboard to manage registrations, verify documents,
record payments, and pull reports.

There are **four staff roles** with different powers:

| Role                 | What they can do                                                |
| -------------------- | --------------------------------------------------------------- |
| **Super Admin**      | Full control — settings, fee overrides, everything              |
| **Location Manager** | Runs one branch — sees only their location's data               |
| **Finance Officer**  | Handles money — invoices, payments, refunds, fee overrides      |
| **Staff**            | Front-desk — registers families, uploads documents, basic work  |

### 🔌 Partner Systems
Other software your club might use (HR systems, accounting tools,
school management software). They get secure access through API keys
so data stays in sync automatically.

---

## Setting Up Your Club

Before parents can register, your **Super Admin** does a one-time setup:

### Step 1 — Add Your Branches (Locations)
Each physical branch is added with a name, address, and **seat
capacity** (how many kids you can host). The system **automatically
generates a unique QR code poster** for each branch.

Print the QR code, stick it on the wall — parents can register simply
by scanning it with their phone.

### Step 2 — Create Sessions
A "session" is any programme you offer: Summer Camp, Football Club,
Art Class, etc. Each session has:
- **Start and end dates** (when the programme runs)
- **Registration window** (when parents can sign up)
- **Payment options** (e.g., pay in full, monthly, or seasonally)

### Step 3 — Sessions Move Through 4 Stages

The system manages session stages **automatically based on dates**:

```
  📝 DRAFT  →  🟢 OPEN  →  🔒 CLOSED  →  📦 ARCHIVED
  (planning)  (accepting   (in progress  (finished —
              registrations) — no new      kept for records)
                             signups)
```

You don't have to manually flip the switch — the system opens
registration on your chosen date and closes it when the window ends.

---

## How a Parent Registers Their Child

This is the heart of the system. Here's the parent's experience:

### Scenario A — Parent Visits Your Branch

1. **Sara walks into your Riyadh branch** with her son Omar.
2. She sees a poster with a **QR code**, scans it with her phone.
3. Her phone opens a clean registration form, **already pre-filled**
   with the branch name.
4. She picks "Summer Football Camp" from the list of available
   sessions and chooses to pay **monthly**.
5. She fills in Omar's name, date of birth, and her own contact
   details.
6. She taps **Submit**.

✨ **Within 1 second**, Sara gets a WhatsApp message confirming her
registration with Omar's unique ID number (like `P-000847`).

### Scenario B — Parent Registers from Home

Same flow, but Sara opens the registration link you shared via
WhatsApp / email / social media. The link can be specific to one
branch and even pre-select the session.

### Scenario C — Staff Registers a Walk-In

A parent prefers face-to-face help? Your staff opens the dashboard,
clicks **"Register New Participant"**, fills in the form for them.
Same outcome — Sara gets her WhatsApp confirmation.

---

## What Happens After Registration?

The system instantly tells Sara **what's next** based on seat
availability:

### 🟢 Outcome 1 — A Seat Is Available
> "Welcome! Omar is enrolled in Summer Football Camp.
> Your first invoice for SAR 1,500 is attached. Please pay within
> 7 days."

Omar is now marked as **"Fee Pending"** — he has a seat, but it
becomes officially confirmed once Sara pays.

### 🟡 Outcome 2 — The Class Is Full (Waitlist)
> "Summer Football Camp is currently full. Omar is **#3 on the
> waitlist**. We'll notify you the moment a seat opens up."

Omar is now on the waitlist. The system **automatically watches for
openings** — if a child withdraws, the next waitlist family gets an
offer within 30 seconds. No staff intervention needed.

---

## The Parent Status Journey

Every child moves through these stages on their way to becoming an
ACTIVE participant:

```
   📥 INQUIRY
   "Welcome — we know about you"
       ↓
   📄 DOCUMENTS PENDING
   "We need your birth certificate & ID photo"
       ↓
   💰 FEE PENDING
   "Documents OK — just waiting for payment"
       ↓
   ✅ ACTIVE
   "All set! Welcome to the club"
       ↓
   (Eventually one of:)
   🎓 COMPLETED      ⏸️ ON HOLD      🚪 WITHDRAWN
   "Session ended"   "Paused for     "No longer
                     a while"        attending"
```

The system **automatically moves families forward** — they're never
stuck waiting because staff forgot to update something.

---

## Documents: Upload, Verify, Auto-Advance

For many programmes you'll require documents like a birth certificate
or ID photo.

### How It Works

1. **Parent uploads** the documents through their portal (or staff
   uploads on their behalf).
2. **Staff reviews** each document and marks it ✅ Verified or
   ❌ Rejected with a reason.
3. The **moment all required documents are verified**, the system
   automatically advances the family to the next stage — no manual
   button to click.

If a document is rejected, the parent gets a WhatsApp explaining why
and asking them to re-upload.

### Privacy & Security
- Documents are **stored securely** with timestamped filenames so a
  re-upload never overwrites the original.
- Only **authorised staff** at the right branch can view them.
- Download links **expire in 15 minutes** so screenshots of URLs
  can't be re-used.

---

## Fees & Invoices

### Choosing How to Pay
When you create a session, you decide which payment options to offer.
A parent can pick at registration time:

| Option       | What it means                                              |
| ------------ | ---------------------------------------------------------- |
| **Full**     | One invoice for the whole programme                        |
| **Monthly**  | One invoice every month for the duration                   |
| **Seasonal** | One invoice per declared season (e.g., quarterly)          |

### Automatic Invoice Generation
The system **automatically creates the invoices** the moment a
family is enrolled. For a 3-month monthly plan it generates 3
invoices, each with the right due date.

Every invoice gets a tidy serial number like `INV-NEM-001234` so
it's easy to reference later.

### Fee Overrides (for special cases)
Need to offer a sibling discount? Need to waive part of a fee for a
special case? Your **Finance Officer or Super Admin** can apply a
fee override with a written reason. The system records:

- Who made the change
- What the original amount was
- What the new amount is
- Why (the reason)

So you always have a clear paper trail.

---

## Payments — Two Easy Paths

### 💳 Path 1 — Online Payment (Card / Apple Pay / Mada / STC Pay)

```
  1. Parent gets WhatsApp with a secure payment link
        ↓
  2. Parent taps the link → opens checkout page (Moyasar / PayTabs)
        ↓
  3. Parent pays with card → immediately confirmed
        ↓
  4. System auto-marks invoice as PAID, generates a receipt PDF
        ↓
  5. Parent gets a "Payment Confirmed" WhatsApp with receipt
        ↓
  6. If this clears their balance → child is automatically promoted
     to ACTIVE 🎉
```

The whole flow takes **under 2 minutes** from receiving the message
to being fully enrolled.

### 💵 Path 2 — Offline Payment (Cash / Bank Transfer)

```
  1. Parent pays at the branch (cash) or by bank transfer
        ↓
  2. Staff uploads proof (cash receipt photo or bank slip)
        ↓
  3. Staff records the payment in the system
        ↓
  4. Payment is marked PENDING VERIFICATION
        ↓
  5. Your Finance Officer reviews and approves
        ↓
  6. Payment moves to COMPLETED, invoice marked PAID
        ↓
  7. Same auto-promotion magic as online payments
```

### Smart Reminders
The system **automatically reminds parents** about upcoming and
overdue invoices on a friendly schedule:

| When             | Message tone                                  |
| ---------------- | --------------------------------------------- |
| 7 days before    | "Just a heads up — payment due next week"     |
| 1 day before     | "Reminder — payment due tomorrow"             |
| On due date      | "Payment due today"                           |
| 3 days overdue   | "Friendly reminder — payment is overdue"      |
| 7 days overdue   | "Please settle this overdue payment"          |

Each reminder includes the payment link — one tap and they're done.
Reminders **stop automatically** once payment is received.

---

## The Waitlist — Never Lose a Customer

When a session fills up, parents don't get a "no" — they get a
**guaranteed spot in line**.

### How the Magic Happens

```
  🪑 Seat opens up (someone withdraws or doesn't pay in time)
        ↓
  ⚡ Within 30 seconds, the system identifies the next family in line
        ↓
  📱 They get a WhatsApp:
     "Good news! A seat just opened in Summer Football Camp.
      Tap ACCEPT within 48 hours to claim it, or DECLINE to
      stay on the waitlist for the next opening."
        ↓
  👍 ACCEPT  →  family is immediately enrolled, invoices generated
  👎 DECLINE →  next family in line gets the offer
  ⏰ NO REPLY in 48h → offer expires, next family gets the chance
```

### Fair Allocation
The waitlist isn't just first-come-first-served. The system also
gives preference to families who **haven't already declined an
offer**, so people don't keep blocking the queue.

### Staff Visibility
At any time, your staff can see:
- Who's on the waitlist for each session
- What position they're in
- Whether they have a live offer pending
- When the offer expires

---

## The Parent Portal

Every parent automatically gets access to a **personal portal**
where they can:

- 👀 View their child's profile and status
- 📋 See all invoices (paid and pending)
- 💳 Pay any pending invoice with one tap
- 📤 Upload missing documents
- 📞 Update their contact info
- 📩 Accept or decline waitlist offers

### How Parents Log In
There are **no passwords** for parents. Instead:

1. Parent enters their email or phone number
2. They get a **magic link** by WhatsApp / email
3. They tap the link → logged in for 7 days

If they lose their phone, anyone else with their email/phone can't
log in for them — the link expires in 15 minutes and can only be
used once.

---

## How the System Talks to People (Notifications)

The system sends **the right message at the right moment** through
the parent's preferred channel:

| Channel         | When it's used                                       |
| --------------- | ---------------------------------------------------- |
| 💬 **WhatsApp** | Primary channel — preferred when phone is on file    |
| 📧 **Email**    | Fallback when WhatsApp isn't available, plus receipts |
| 📱 **SMS**      | Backup for critical alerts                            |

### Smart Deduplication
You'll never accidentally bombard a parent. The system **detects
duplicates** — if a payment link gets re-issued for the same invoice,
the parent doesn't get two messages. The same protection applies to
every notification type.

### Bilingual Support
All messages go out in the **parent's preferred language**
(English or Arabic) — they choose this at registration time.

---

## Reports for Managers

Your dashboard gives you **live answers** to the questions you ask
every day:

### 📊 Main Dashboard
At a glance you see:
- How many ACTIVE participants you have
- How many new INQUIRIES this week
- How many are waiting on documents
- How many have unpaid fees
- Capacity utilisation per branch (e.g., "Riyadh: 38/40 seats filled")

### 💰 Fees Report
- Total invoiced this month
- Total collected
- Total still pending
- Total overdue

### 🎯 Conversion Funnel
See how families flow through your pipeline:
> 100 registered → 85 uploaded documents → 75 paid → 73 became ACTIVE

This shows you exactly where families are dropping off so you can
fix the leaks.

### 📈 Revenue Report
Day-by-day, week-by-week, or month-by-month revenue charts based on
actually-received payments.

### 🪑 Capacity Report
Per-session occupancy + waitlist size, so you know which sessions
to open more of and which ones aren't filling up.

### Role-Based Views
**Location Managers automatically see only their branch**. They can't
accidentally view (or report on) other branches' data. Your Super
Admin and Finance Officer see everything across all branches.

---

## Behind the Scenes — What Runs Automatically

The system has **5 silent helpers** running in the background so your
staff never have to chase down repetitive tasks:

| Helper                      | What it does                                                        | How often      |
| --------------------------- | ------------------------------------------------------------------- | -------------- |
| 📅 **Session Opener**       | Automatically opens registration when the date arrives, closes it when the window ends | Every 30 min   |
| 🔍 **Seat Watcher**         | Watches every session for new openings and offers them to waitlist  | Every 30 sec   |
| ⏰ **Offer Timer**           | Expires unclaimed waitlist offers after 48 hours, moves to next family | Every 5 min    |
| 💳 **Payment Receiver**     | Confirms online payments coming back from card gateways             | Every minute   |
| 📩 **Reminder Sender**      | Sends payment reminders at the right times before/after due date    | Every hour     |

All of these run safely — they never duplicate work, never spam
parents, and quietly log everything they do.

---

## Security & Trust

### 🔐 Tamper-Evident Audit Log
Every important action — every status change, every payment, every
fee override — is recorded in a **tamper-evident log**. The records
are cryptographically chained together, meaning if anyone tried to
secretly edit history, the system would detect it instantly.

### 🛡️ Role-Based Access
A Location Manager **physically cannot see** other branches' data.
A regular Staff member **cannot verify payments** or change fees.
The system enforces these rules at every step.

### 🗝️ API Keys for Partners
If you want to connect another system (your HR software, accounting
tool, etc.), the Super Admin generates an **API key** with specific
permissions:

> "This key can READ participants and READ enrolments, but cannot
> change anything."

Keys can be revoked instantly. Every API call is rate-limited so
even a buggy partner system can't accidentally overload your service.

### 🔒 Sensitive Data Protection
- Passwords are hashed (impossible to recover, even by us)
- API keys are stored encrypted — a database leak won't expose them
- Document download links expire in 15 minutes
- Magic links expire in 15 minutes and only work once
- Optional two-factor authentication for staff accounts

---

## A Real Family's Story (End-to-End)

Let's follow **Sara and her son Omar** through their entire journey
to make this concrete.

### Day 1 — Discovery
Sara walks past your Riyadh branch and sees a poster:

> 📷 "Summer Football Camp — Scan to Register!"

She scans the QR code. Her phone opens a clean form pre-filled with
"Riyadh Branch". She picks **Summer Football Camp** (3 months,
SAR 4,500), selects **monthly payment**, and fills in Omar's details.

She taps **Submit**.

**📱 Within 1 second** she gets a WhatsApp:

> "Welcome! Omar is enrolled in Summer Football Camp.
> Your participant ID is P-000847.
> Your first invoice for SAR 1,500 will arrive shortly.
> Please upload Omar's birth certificate and ID photo through this link."

### Day 1 — Continued
Sara taps the upload link, takes photos of both documents, uploads.

Behind the scenes, your front-desk staff sees them appear in the
"Documents to Verify" queue. They review and mark both ✅ Verified.

Sara gets a WhatsApp:

> "Great news — Omar's documents are verified. ✅"

### Day 1 — Invoice Arrives
Sara gets another WhatsApp:

> "Invoice INV-NEM-001234 for SAR 1,500 is ready.
> Tap here to pay → [secure payment link]
> Due: 7 days"

She taps the link, enters her card details, pays. Done in 90 seconds.

**📱 Instantly** she gets:

> "Payment confirmed! 🎉 Receipt attached."

Omar's status goes from "Fee Pending" → **ACTIVE**. He's officially
in the camp.

### Day 30 — Monthly Reminder Cycle
A week before the next monthly invoice is due, Sara gets:

> "Friendly heads up — your next payment of SAR 1,500 is due
> next week. Tap here to pay early → [link]"

She pays. The cycle continues for month 3.

### Day 75 — Summer Ends
The session ends. The system automatically moves Omar to
**COMPLETED** status. Sara gets a thank-you message and an invitation
to enrol Omar in the upcoming Fall programme.

### Day 80 — Khaled's Story (The Waitlist)
Meanwhile, **Khaled** tried to enrol his daughter in the same Summer
Football Camp but the class was full when he registered. He went on
the waitlist at position #3.

Over the 3 months, two other families withdrew. Each time a seat
opened, the system silently offered it — first to family #1 (who
declined), then to family #2 (who accepted).

When the third seat opened, Khaled got a WhatsApp:

> "Good news! A seat just opened in Summer Football Camp.
> Tap ACCEPT within 48 hours to claim it.
> ✅ Accept    ❌ Decline"

He accepted within 5 minutes. He went through the same invoice +
document flow Sara did, all without any staff intervention.

---

## What This Means for Your Club

✅ **Less paperwork** — registrations, invoices, receipts, audit
trail all happen automatically.

✅ **Happier parents** — they get clear updates at every step, and
can pay/upload/check from their phone 24/7.

✅ **Fewer mistakes** — automated status transitions and built-in
guards prevent over-booking, double-charging, and forgotten reminders.

✅ **No lost customers** — the waitlist + automatic offering ensures
no family is ever turned away without follow-up.

✅ **Live insight** — your manager dashboard always shows the truth
about your operations.

✅ **Total transparency** — every change is logged, so if a parent
ever disputes anything, you have proof of exactly what happened.

✅ **Scales effortlessly** — whether you have 50 kids or 5,000, the
system handles it the same way.

---

## Frequently Asked Questions

### What happens if our internet goes down?
Parents can still pay in cash at the branch — staff records the
payment offline. Once internet returns, everything syncs.

### Can a parent register multiple children?
Yes — they just submit the form once per child. All children are
linked to the same parent automatically.

### What if a parent loses their phone?
They can request a new magic link from a different device, as long
as they remember their email or phone number on file.

### Can we send custom messages?
Yes — the template library can be edited per tenant. Languages
supported: English and Arabic.

### What payment gateways do you support?
Moyasar, PayTabs, and HyperPay — all the major Saudi gateways.
Adding others is a small extension.

### Can I run multiple branches under one account?
Yes — that's exactly what the system is designed for. Each branch
has its own capacity, its own QR code, its own staff, and its own
reports — but they all share one parent organisation.

### Is data private between branches?
Yes — a Location Manager at Branch A literally cannot see Branch B's
data. The system enforces this on every query.

### How do partner integrations work?
Your Super Admin generates an API key, decides which permissions it
has, and shares it with the partner. They use it to read/write data
programmatically. You can revoke the key any time.

### What if someone tries to over-pay an invoice?
The system handles partial payments naturally — if a parent pays
SAR 500 toward a SAR 1,500 invoice, it stays "Pending" with a
balance of SAR 1,000. The next payment closes the gap.

### What about refunds?
Refunds are recorded as a separate payment status. The audit log
captures who issued the refund and why.

---

## Glossary (Plain English)

| Term            | What it means                                                |
| --------------- | ------------------------------------------------------------ |
| **Tenant**      | Your club organisation                                       |
| **Location**    | A physical branch (e.g., Riyadh, Jeddah, Dammam)             |
| **Session**     | A specific programme/class (e.g., Summer Camp 2026)          |
| **Participant** | A child enrolled (or registering) at your club               |
| **Guardian**    | A parent / legal guardian of a participant                   |
| **Enrolment**   | The official link between a participant and a session        |
| **Invoice**     | A bill for a specific amount, with a due date                |
| **Payment**     | Money received (online or offline)                           |
| **Waitlist**    | The ordered queue of families waiting for a seat             |
| **Magic Link**  | A one-time secure link sent to a parent for passwordless login |
| **API Key**     | A secure credential that lets partner systems talk to yours   |

---

## In One Sentence

> **Neomora Club Manager is your always-on office assistant — it
> handles registrations, documents, invoices, payments, waitlists,
> reminders, and reports automatically, so your team can focus on
> delivering great programmes to families instead of pushing paper.**

---

_Companion documents for technical teams:_
- _`API_DOCUMENTATION.md` — full developer endpoint reference_
- _`PROJECT_FLOW.md` — detailed technical workflow documentation_
- _`neomora-api.postman_collection.json` — ready-to-import Postman_
