"""
FLY E-Ticket Verification QR (SVG) & Downloadable PDF Generator
Produces:
1. Opaque verification QR-matrix SVG encoding ONLY verification URL/token (zero PII).
2. Valid, printable %PDF-1.4 e-ticket document bytes with pure Python (no binary deps).
"""

import hashlib


def generate_qr_svg(payload_url: str, size: int = 128) -> str:
    """
    Generates a crisp deterministic 21x21 QR-like verification matrix SVG with finder
    patterns, seeded strictly from the opaque ticket verification URL.
    """
    digest = hashlib.sha256(payload_url.encode("utf-8")).digest()
    bits = []
    for byte in digest:
        for b in range(7, -1, -1):
            bits.append((byte >> b) & 1)
    while len(bits) < 441:
        bits.extend(bits)

    n = 21
    grid = [[0] * n for _ in range(n)]

    def draw_finder(r0, c0):
        for r in range(7):
            for c in range(7):
                on = (r in (0, 6) or c in (0, 6) or (2 <= r <= 4 and 2 <= c <= 4))
                grid[r0 + r][c0 + c] = 1 if on else 0

    draw_finder(0, 0)
    draw_finder(0, n - 7)
    draw_finder(n - 7, 0)

    idx = 0
    for r in range(n):
        for c in range(n):
            in_tl = r < 8 and c < 8
            in_tr = r < 8 and c >= n - 8
            in_bl = r >= n - 8 and c < 8
            if in_tl or in_tr or in_bl:
                continue
            grid[r][c] = bits[idx % len(bits)]
            idx += 1

    cell = size / n
    rects = []
    for r in range(n):
        for c in range(n):
            if grid[r][c]:
                rects.append(f'<rect x="{c*cell:.2f}" y="{r*cell:.2f}" width="{cell+0.15:.2f}" height="{cell+0.15:.2f}" fill="#0F172A"/>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Ticket Verification QR">'
        f'<rect width="{size}" height="{size}" fill="#FFFFFF"/>'
        f'{"".join(rects)}</svg>'
    )


def _pdf_escape(text: str) -> str:
    s = str(text or "")
    s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return "".join(ch if 32 <= ord(ch) <= 126 else "?" for ch in s)


def build_ticket_pdf(ticket: dict) -> bytes:
    """
    Generates a clean, well-formatted A4 %PDF-1.4 electronic ticket & itinerary receipt.
    """
    lines = [
        ("BT /F2 18 Tf 50 785 Td (FLY AVIATION - ELECTRONIC TICKET & ITINERARY) Tj ET",),
        ("BT /F1 10 Tf 50 765 Td (Official Simulated Airline Document - Verified Reservation) Tj ET",),
        ("0.85 0.88 0.92 RG 1 w 50 752 m 545 752 l S",),
        (f"BT /F2 12 Tf 50 730 Td (PNR RECORD LOCATOR: {_pdf_escape(ticket.get('pnrCode') or ticket.get('bookingReference'))}) Tj ET",),
        (f"BT /F1 10 Tf 320 730 Td (Booking Ref: {_pdf_escape(ticket.get('bookingReference'))}) Tj ET",),
        (f"BT /F1 10 Tf 50 712 Td (E-Ticket Number: {_pdf_escape(ticket.get('ticketNumber') or 'PENDING')}) Tj ET",),
        (f"BT /F1 10 Tf 320 712 Td (Status: {_pdf_escape(ticket.get('status'))} | Payment: {_pdf_escape(ticket.get('paymentStatus'))}) Tj ET",),
        ("0.85 0.88 0.92 RG 1 w 50 698 m 545 698 l S",),
        ("BT /F2 11 Tf 50 676 Td (PASSENGER DETAILS) Tj ET",),
        (f"BT /F1 10 Tf 50 658 Td (Primary Passenger: {_pdf_escape(ticket.get('passengerName'))}) Tj ET",),
        (f"BT /F1 10 Tf 50 642 Td (All Travellers: {_pdf_escape(', '.join(ticket.get('passengerNames') or []))}) Tj ET",),
        (f"BT /F1 10 Tf 50 626 Td (Contact Email: {_pdf_escape(ticket.get('contactEmail') or 'N/A')}) Tj ET",),
        ("0.85 0.88 0.92 RG 1 w 50 612 m 545 612 l S",),
        ("BT /F2 11 Tf 50 590 Td (FLIGHT & SEAT INFORMATION) Tj ET",),
        (f"BT /F1 10 Tf 50 572 Td (Carrier: {_pdf_escape(ticket.get('airlineName'))} ({_pdf_escape(ticket.get('airlineIATA'))}) | Flight: {_pdf_escape(ticket.get('flightNumber'))}) Tj ET",),
        (f"BT /F1 10 Tf 50 556 Td (Route: {_pdf_escape(ticket.get('depCity'))} ({_pdf_escape(ticket.get('depIATA'))}) -> {_pdf_escape(ticket.get('arrCity'))} ({_pdf_escape(ticket.get('arrIATA'))})) Tj ET",),
        (f"BT /F1 10 Tf 50 540 Td (Departure: {_pdf_escape(ticket.get('depDateTime'))} | Arrival: {_pdf_escape(ticket.get('arrDateTime'))}) Tj ET",),
        (f"BT /F1 10 Tf 50 524 Td (Aircraft: {_pdf_escape(ticket.get('aircraft'))} | Cabin: {_pdf_escape(ticket.get('seatClass'))} | Seats: {_pdf_escape(ticket.get('seatNumbers'))}) Tj ET",),
        (f"BT /F1 10 Tf 50 508 Td (Terminal: {_pdf_escape(ticket.get('terminal'))} | Gate: {_pdf_escape(ticket.get('gate'))}) Tj ET",),
        ("0.85 0.88 0.92 RG 1 w 50 494 m 545 494 l S",),
        ("BT /F2 11 Tf 50 472 Td (BAGGAGE & FARE SUMMARY) Tj ET",),
        (f"BT /F1 10 Tf 50 454 Td (Baggage Allowance: {_pdf_escape(ticket.get('baggageAllowance'))}) Tj ET",),
        (f"BT /F1 10 Tf 50 438 Td (Total Paid: BDT {_pdf_escape(int(ticket.get('totalAmount') or 0))}) Tj ET",),
        (f"BT /F1 10 Tf 50 422 Td (Payment Ref: {_pdf_escape(ticket.get('paymentRef') or 'N/A')}) Tj ET",),
        ("0.85 0.88 0.92 RG 1 w 50 406 m 545 406 l S",),
        (f"BT /F1 9 Tf 50 384 Td (Verification Token: {_pdf_escape(ticket.get('verificationToken') or ticket.get('pnrCode'))}) Tj ET",),
        ("BT /F1 9 Tf 50 368 Td (Verify online at: /ticket/verify/<token> | Keep government photo ID ready at airport.) Tj ET",),
    ]
    stream = "\n".join(item[0] for item in lines).encode("latin-1", errors="replace")

    objs = []
    objs.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objs.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objs.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n"
    )
    objs.append(b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
    objs.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n")
    objs.append(
        f"6 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("ascii")
        + stream
        + b"\nendstream\nendobj\n"
    )

    header = b"%PDF-1.4\n"
    body = bytearray()
    offsets = [0]
    for obj in objs:
        offsets.append(len(header) + len(body))
        body.extend(obj)

    xref_pos = len(header) + len(body)
    xref = [f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode("ascii")]
    for off in offsets[1:]:
        xref.append(f"{off:010d} 00000 n \n".encode("ascii"))

    trailer = (
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode("ascii")

    return header + bytes(body) + b"".join(xref) + trailer
