"""
FLY E-Ticket Verification QR & High-Resolution Printable PDF Generator
Produces:
1. Genuine ISO-18004 scannable QR SVG/PNG encoding configured LAN/HTTPS verification URL.
2. Clean, structured A4 %PDF-1.4 electronic ticket & itinerary receipt embedding
   a lossless FlateDecode RGB QR bitmap + itinerary segments + support notice.
"""

import zlib
from config import Config
from fly.services.qr_service import generate_qr_rgb_image, generate_qr_svg  # noqa: F401


def _pdf_escape(text: str) -> str:
    s = str(text or "")
    s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return "".join(ch if 32 <= ord(ch) <= 126 else "?" for ch in s)


def build_ticket_pdf(ticket: dict, verify_url: str = None) -> bytes:
    """
    Generates an A4 %PDF-1.4 Electronic Ticket & Itinerary Receipt with an embedded,
    camera-scannable high-resolution QR code (when the ticket is legitimately ISSUED).
    """
    is_issued = str(ticket.get("issuanceState") or ticket.get("ticketStatus") or ticket.get("status") or "").upper() in ("ISSUED", "PARTIALLY_USED")
    is_test = bool(ticket.get("isTestTicket", True))

    segments = ticket.get("segments") or [
        {
            "origin_iata": ticket.get("depIATA"),
            "dest_iata": ticket.get("arrIATA"),
            "dep_datetime": ticket.get("depDateTime"),
            "arr_datetime": ticket.get("arrDateTime"),
            "seat_code": ticket.get("seatNumbers"),
            "cabin_class": ticket.get("seatClass"),
            "coupon_status": ticket.get("ticketStatus") or "ISSUED",
        }
    ]

    content_cmds = [
        # Brand header banner
        "0.06 0.11 0.18 rg 40 742 515 68 re f",
        "1 1 1 rg BT /F2 17 Tf 55 786 Td (FLY AVIATION - ELECTRONIC TICKET & ITINERARY RECEIPT) Tj ET",
        f"0.75 0.85 0.96 rg BT /F1 9 Tf 55 768 Td ({_pdf_escape('E-Ticket Document (Distinct from Airline Airport Boarding Pass)' + (' | TEST FIXTURE' if is_test else ''))}) Tj ET",
        f"0.75 0.85 0.96 rg BT /F1 9 Tf 55 753 Td (Support: {_pdf_escape(Config.SUPPORT_PHONE)} | {_pdf_escape(Config.SUPPORT_EMAIL)}) Tj ET",
        "0.06 0.09 0.16 rg",
        # Booking & E-Ticket metadata
        f"BT /F2 11 Tf 50 718 Td (PNR: {_pdf_escape(ticket.get('pnrCode') or '--')}   |   Booking Ref: {_pdf_escape(ticket.get('bookingReference'))}) Tj ET",
        f"BT /F2 10 Tf 50 700 Td (E-Ticket Number: {_pdf_escape(ticket.get('ticketNumber') or 'TICKETING PENDING')}) Tj ET",
        f"BT /F1 10 Tf 50 684 Td (Ticket Status: {_pdf_escape(ticket.get('ticketStatus') or ticket.get('status'))}   |   Payment: {_pdf_escape(ticket.get('paymentStatus') or '--')}) Tj ET",
        "0.85 0.88 0.92 RG 1 w 50 672 m 545 672 l S",
        # Passenger & Baggage
        "BT /F2 11 Tf 50 654 Td (PASSENGER & TICKET HOLDER) Tj ET",
        f"BT /F1 10 Tf 50 638 Td (Passenger: {_pdf_escape(ticket.get('passengerName'))}) Tj ET",
        f"BT /F1 10 Tf 50 622 Td (Travellers on Itinerary: {_pdf_escape(', '.join(ticket.get('passengerNames') or []))}) Tj ET",
        f"BT /F1 10 Tf 50 606 Td (Baggage Allowance: {_pdf_escape(ticket.get('baggageAllowance') or '23 kg Checked')}) Tj ET",
        "0.85 0.88 0.92 RG 1 w 50 594 m 545 594 l S",
        # Primary Flight Info
        "BT /F2 11 Tf 50 576 Td (FLIGHT & SEGMENT DETAILS) Tj ET",
        f"BT /F1 10 Tf 50 560 Td (Carrier: {_pdf_escape(ticket.get('airlineName'))} ({_pdf_escape(ticket.get('airlineIATA'))})   Flight: {_pdf_escape(ticket.get('flightNumber'))}) Tj ET",
        f"BT /F1 10 Tf 50 544 Td (Route: {_pdf_escape(ticket.get('depCity'))} ({_pdf_escape(ticket.get('depIATA'))}) -> {_pdf_escape(ticket.get('arrCity'))} ({_pdf_escape(ticket.get('arrIATA'))})) Tj ET",
        f"BT /F1 10 Tf 50 528 Td (Departure: {_pdf_escape(ticket.get('depDateTime'))}   |   Arrival: {_pdf_escape(ticket.get('arrDateTime'))}) Tj ET",
        f"BT /F1 10 Tf 50 512 Td (Cabin: {_pdf_escape(ticket.get('seatClass'))}   |   Seat(s): {_pdf_escape(ticket.get('seatNumbers'))}   |   Aircraft: {_pdf_escape(ticket.get('aircraft'))}) Tj ET",
    ]

    y = 492
    for idx, seg in enumerate(segments[:4], start=1):
        seg_line = (
            f"Seg {idx}: {seg.get('origin_iata')} -> {seg.get('dest_iata')} | "
            f"{seg.get('dep_datetime')} | Seat {seg.get('seat_code') or ticket.get('seatNumbers') or '--'} | "
            f"Coupon: {seg.get('coupon_status') or 'OPEN'}"
        )
        content_cmds.append(f"BT /F1 9 Tf 50 {y} Td ({_pdf_escape(seg_line)}) Tj ET")
        y -= 15

    content_cmds.extend([
        "0.85 0.88 0.92 RG 1 w 50 416 m 545 416 l S",
        "BT /F2 11 Tf 50 398 Td (FARE & PAYMENT SUMMARY) Tj ET",
        f"BT /F1 10 Tf 50 382 Td (Total Paid: BDT {_pdf_escape(int(round(float(ticket.get('totalAmount') or 0))))}) Tj ET",
        f"BT /F1 10 Tf 50 366 Td (Payment Ref: {_pdf_escape(ticket.get('paymentRef') or 'N/A')}) Tj ET",
        f"BT /F1 9 Tf 50 350 Td (Issued At (UTC): {_pdf_escape(ticket.get('issuedAt') or 'Pending')}) Tj ET",
        "0.85 0.88 0.92 RG 1 w 50 332 m 545 332 l S",
    ])

    has_qr_img = bool(is_issued and verify_url)
    img_w = img_h = 0
    compressed_rgb = b""
    if has_qr_img:
        qr_img = generate_qr_rgb_image(verify_url, box_pixels=8)
        img_w, img_h = qr_img.size
        compressed_rgb = zlib.compress(qr_img.tobytes(), level=6)
        # QR frame on bottom-right, clear instructions on left
        content_cmds.extend([
            "0.96 0.98 1.0 rg 48 156 500 162 re f",
            "0.78 0.84 0.91 RG 1 w 48 156 500 162 re S",
            "0.06 0.09 0.16 rg",
            "BT /F2 12 Tf 64 290 Td (Scan this QR code to verify your FLY ticket.) Tj ET",
            "BT /F1 9 Tf 64 270 Td (Mobile Camera Verification: Connect to the FLY server network and scan with any) Tj ET",
            "BT /F1 9 Tf 64 256 Td (standard smartphone camera to inspect live ticket issuance & travel validity.) Tj ET",
            f"BT /F1 8 Tf 64 234 Td (Verification URL: {_pdf_escape(verify_url)}) Tj ET",
            "BT /F1 8 Tf 64 214 Td (Notice: E-Ticket verification does not check you in for your flight.) Tj ET",
            "BT /F1 8 Tf 64 200 Td (Present this receipt and government photo ID at the airline airport counter.) Tj ET",
            # Draw high-res QR image at (398, 172), 132x132 pt
            "q 132 0 0 132 398 172 cm /Im1 Do Q",
        ])
    else:
        content_cmds.extend([
            "BT /F2 11 Tf 50 296 Td (QR VERIFICATION UNAVAILABLE) Tj ET",
            f"BT /F1 9 Tf 50 278 Td (Ticket state is {_pdf_escape(ticket.get('issuanceState') or ticket.get('status'))}. A valid QR is only emitted for ISSUED tickets.) Tj ET",
        ])

    content_cmds.append(
        f"BT /F1 8 Tf 50 112 Td (Official Support: {_pdf_escape(Config.SUPPORT_PHONE)} | {_pdf_escape(Config.SUPPORT_EMAIL)} | FLY Ticketing Platform) Tj ET"
    )

    stream = "\n".join(content_cmds).encode("latin-1", errors="replace")

    objs = []
    objs.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objs.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    if has_qr_img:
        objs.append(
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 7 0 R >> >> "
            b"/Contents 6 0 R >>\nendobj\n"
        )
    else:
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
    if has_qr_img:
        objs.append(
            (
                f"7 0 obj\n<< /Type /XObject /Subtype /Image /Width {img_w} /Height {img_h} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                f"/Length {len(compressed_rgb)} >>\nstream\n"
            ).encode("ascii")
            + compressed_rgb
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
