/**
 * FLY FLIGHT BOOKING SYSTEM - SEAT SELECTION MODULE
 * Author: mahin1710
 * Technologies: Vanilla JavaScript, Fetch API
 * Description: Clean, beginner-friendly script for aircraft seat selection and 15-min atomic holds.
 */

const seatSelectionModule = {
  flightId: 1,
  selectedSeats: [],

  // Helper to retrieve auth token
  getAuthHeaders() {
    const token = localStorage.getItem('fly_token') || sessionStorage.getItem('fly_token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  },

  // 1. Load seat availability from Python Flask backend
  async loadSeats(flightId = 1) {
    this.flightId = flightId;
    const gridEl = document.getElementById('seatMapGrid');
    if (!gridEl) return;

    try {
      const res = await fetch(`/api/flights/${flightId}/seats`, {
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      const seats = data.seats || (Array.isArray(data) ? data : []);
      this.renderSeats(seats);
    } catch (err) {
      console.error('Failed to load seats:', err);
      gridEl.innerHTML = '<div style="color: #ef4444; padding: 20px;">Unable to load seat map.</div>';
    }
  },

  // 2. Render seats into interactive grid
  renderSeats(seats) {
    const gridEl = document.getElementById('seatMapGrid');
    if (!gridEl) return;

    gridEl.innerHTML = seats.map(s => {
      const isSelected = this.selectedSeats.includes(s.id);
      let statusClass = 'seat-available';
      let title = `Seat ${s.code} (${s.type})`;

      if (s.status === 'BOOKED') {
        statusClass = 'seat-booked';
        title += ' - Already Booked';
      } else if (s.status === 'HELD') {
        statusClass = s.isHeldByMe ? 'seat-held-by-me' : 'seat-held';
        title += s.isHeldByMe ? ' - Held by You (15-min lock)' : ' - Temporarily Held by Another User';
      } else if (isSelected) {
        statusClass = 'seat-selected';
      }

      return `
        <div class="seat-item ${statusClass}"
             data-id="${s.id}"
             data-code="${s.code}"
             data-status="${s.status}"
             onclick="seatSelectionModule.toggleSeat(${s.id}, '${s.code}', '${s.status}')"
             title="${title}">
          ${s.code}
        </div>
      `;
    }).join('');

    this.updateSelectedLabel();
  },

  // 3. Toggle seat selection
  toggleSeat(seatId, seatCode, status) {
    if (status === 'BOOKED' || status === 'HELD') {
      alert(`Seat ${seatCode} is unavailable.`);
      return;
    }

    const idx = this.selectedSeats.indexOf(seatId);
    if (idx >= 0) {
      this.selectedSeats.splice(idx, 1);
    } else {
      this.selectedSeats.push(seatId);
    }

    this.loadSeats(this.flightId);
  },

  updateSelectedLabel() {
    const labelEl = document.getElementById('selectedSeatsLabel');
    if (labelEl) {
      labelEl.innerText = this.selectedSeats.length > 0 ? `${this.selectedSeats.length} Seat(s)` : 'None';
    }
  },

  // 4. Hold selected seats for 15 minutes (Calls Python API)
  async holdSeats() {
    if (this.selectedSeats.length === 0) {
      alert('Please select at least one seat to hold.');
      return;
    }

    try {
      const res = await fetch('/api/bookings/hold', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          flightId: this.flightId,
          seatIds: this.selectedSeats
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Seat holding failed.');
        return;
      }

      // Store booking reference and redirect to payment checkout
      sessionStorage.setItem('fly_active_booking', JSON.stringify({
        bookingReference: data.bookingReference,
        expiresAt: data.expiresAt
      }));

      window.location.href = `/payment?ref=${data.bookingReference}`;
    } catch (err) {
      console.error(err);
      alert('Network error while holding seats.');
    }
  }
};

// Initialize on page load if seat map container exists
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('seatMapGrid')) {
    seatSelectionModule.loadSeats(1);
  }
});
