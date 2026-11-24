/**
 * FLY AVIATION - TYPED NORMALIZED FLIGHT DATA MODELS
 * Author: mahin1710
 *
 * Provides normalized, decoupled data models:
 *  - BaggageAllowance
 *  - FareConditions
 *  - PriceBreakdown
 *  - FlightSegment
 *  - FlightOffer
 *
 * UI components interact strictly with these models and never couple
 * to raw external GDS/NDC provider payloads.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FlightModels = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------------------------------------------------------------
  // 1. UTILITY HELPERS
  // -------------------------------------------------------------
  function formatMinutesToHoursMinutes(minutes) {
    if (typeof minutes !== 'number' || isNaN(minutes) || minutes < 0) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function formatISOTime(isoString) {
    if (!isoString) return '';
    try {
      const parts = isoString.split('T');
      if (parts.length > 1) {
        const timePart = parts[1].slice(0, 5); // HH:MM
        const [hourStr, minStr] = timePart.split(':');
        let hour = parseInt(hourStr, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;
        const formattedHour = String(hour).padStart(2, '0');
        return `${formattedHour}:${minStr} ${ampm}`;
      }
    } catch (_) { }
    return isoString;
  }

  function formatISODate(isoString) {
    if (!isoString) return '';
    try {
      const datePart = isoString.split('T')[0];
      const [year, month, day] = datePart.split('-');
      const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { }
    return isoString.split('T')[0] || '';
  }

  function formatMoney(amount, currency = 'BDT') {
    const num = Number(amount) || 0;
    const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (currency === 'BDT') return `৳${formatted}`;
    if (currency === 'USD') return `$${formatted}`;
    return `${currency} ${formatted}`;
  }

  // -------------------------------------------------------------
  // 2. BAGGAGE ALLOWANCE MODEL
  // -------------------------------------------------------------
  class BaggageAllowance {
    constructor(data = {}) {
      this.cabinPieces = Number.isInteger(data.cabinPieces) ? data.cabinPieces : 1;
      this.cabinWeightKg = typeof data.cabinWeightKg === 'number' ? data.cabinWeightKg : 7;
      this.checkedPieces = Number.isInteger(data.checkedPieces) ? data.checkedPieces : 1;
      this.checkedWeightKg = typeof data.checkedWeightKg === 'number' ? data.checkedWeightKg : 20;
      this.description = data.description || this.formatSummary();
    }

    hasCheckedBaggage() {
      return (this.checkedPieces > 0 && this.checkedWeightKg > 0);
    }

    formatSummary() {
      const parts = [];
      if (this.hasCheckedBaggage()) {
        parts.push(`${this.checkedWeightKg} kg Check-in`);
      } else {
        parts.push('No checked baggage');
      }
      if (this.cabinPieces > 0) {
        parts.push(`${this.cabinWeightKg} kg Cabin`);
      }
      return parts.join(' • ');
    }
  }

  // -------------------------------------------------------------
  // 3. FARE CONDITIONS MODEL
  // -------------------------------------------------------------
  class FareConditions {
    constructor(data = {}) {
      this.refundable = Boolean(data.refundable);
      this.refundableWithFee = Boolean(data.refundableWithFee);
      this.changeable = Boolean(data.changeable);
      this.cancellationFee = Number(data.cancellationFee) || 0;
      this.changeFee = Number(data.changeFee) || 0;
      this.fareFamily = data.fareFamily || 'Economy Standard';
      this.refundPolicyText = data.refundPolicyText || (
        this.refundable ? 'Fully refundable before departure' :
        this.refundableWithFee ? `Refundable up to 24h prior to departure (Fee: ৳${this.cancellationFee.toLocaleString()})` :
        'Non-refundable ticket'
      );
    }

    isRefundable() {
      return this.refundable || this.refundableWithFee;
    }

    getBadgeLabel() {
      if (this.refundable) return 'Refundable';
      if (this.refundableWithFee) return 'Refundable (Fees Apply)';
      return 'Non-refundable';
    }
  }

  // -------------------------------------------------------------
  // 4. PRICE BREAKDOWN MODEL
  // -------------------------------------------------------------
  class PriceBreakdown {
    constructor(data = {}) {
      this.currency = data.currency || 'BDT';
      this.baseFare = Number(data.baseFare) || 0;
      this.taxes = Number(data.taxes) || 0;
      this.airlineFees = Number(data.airlineFees) || 0;
      this.serviceFee = Number(data.serviceFee) || 0;
      this.discount = Number(data.discount) || 0;
      this.totalAmount = typeof data.totalAmount === 'number' 
        ? data.totalAmount 
        : (this.baseFare + this.taxes + this.airlineFees + this.serviceFee - this.discount);
      this.perPassenger = Number(data.perPassenger) || this.totalAmount;
    }

    getFormattedTotal() {
      return formatMoney(this.totalAmount, this.currency);
    }

    getFormattedBaseFare() {
      return formatMoney(this.baseFare, this.currency);
    }

    getFormattedTaxes() {
      return formatMoney(this.taxes, this.currency);
    }
  }

  // -------------------------------------------------------------
  // 5. FLIGHT SEGMENT MODEL
  // -------------------------------------------------------------
  class FlightSegment {
    constructor(data = {}) {
      this.id = data.id || `SEG-${Math.random().toString(36).substr(2, 9)}`;
      this.carrierCode = data.carrierCode || 'BG';
      this.carrierName = data.carrierName || 'Biman Bangladesh Airlines';
      this.carrierLogo = data.carrierLogo || '✈️';
      this.flightNumber = data.flightNumber || 'BG-000';
      
      this.marketingCarrier = data.marketingCarrier || {
        code: this.carrierCode,
        name: this.carrierName
      };

      this.operatingCarrier = data.operatingCarrier || {
        code: this.carrierCode,
        name: this.carrierName
      };

      this.aircraft = data.aircraft || 'Boeing 737-800';
      this.cabinClass = data.cabinClass || 'Economy';

      this.origin = {
        code: data.origin?.code || 'DAC',
        city: data.origin?.city || 'Dhaka',
        airport: data.origin?.airport || 'Hazrat Shahjalal International Airport',
        terminal: data.origin?.terminal || 'Terminal 1'
      };

      this.destination = {
        code: data.destination?.code || 'CXB',
        city: data.destination?.city || "Cox's Bazar",
        airport: data.destination?.airport || "Cox's Bazar Airport",
        terminal: data.destination?.terminal || 'Main Terminal'
      };

      this.departureTime = data.departureTime || '2026-11-28T10:00:00';
      this.arrivalTime = data.arrivalTime || '2026-11-28T11:00:00';
      this.durationMinutes = Number(data.durationMinutes) || 60;
      this.layoverAfterMinutes = Number(data.layoverAfterMinutes) || 0;
      this.layoverAirport = data.layoverAirport || null; // e.g. { code: 'CGP', city: 'Chittagong', airport: '...' }
    }

    getDepartureTimeString() {
      return formatISOTime(this.departureTime);
    }

    getArrivalTimeString() {
      return formatISOTime(this.arrivalTime);
    }

    getDepartureDateString() {
      return formatISODate(this.departureTime);
    }

    getArrivalDateString() {
      return formatISODate(this.arrivalTime);
    }

    getFormattedDuration() {
      return formatMinutesToHoursMinutes(this.durationMinutes);
    }

    isOvernight() {
      const depDate = this.departureTime.split('T')[0];
      const arrDate = this.arrivalTime.split('T')[0];
      return depDate !== arrDate;
    }

    hasDifferentOperatingCarrier() {
      return this.operatingCarrier.code !== this.marketingCarrier.code || 
             this.operatingCarrier.name !== this.marketingCarrier.name;
    }
  }

  // -------------------------------------------------------------
  // 6. FLIGHT OFFER MODEL (AGGREGATE ROOT)
  // -------------------------------------------------------------
  class FlightOffer {
    constructor(data = {}) {
      this.id = data.id || `DEMO-OFFER-${Math.random().toString(36).substr(2, 9)}`;
      this.source = 'demo-fixture';
      this.isBookable = false; // Typed guarantee: demo offer is NOT bookable
      this.disclaimer = 'Demo data – not bookable';

      // Normalized Segments
      this.segments = Array.isArray(data.segments) && data.segments.length > 0
        ? data.segments.map(s => (s instanceof FlightSegment ? s : new FlightSegment(s)))
        : [new FlightSegment()];

      this.baggage = data.baggage instanceof BaggageAllowance 
        ? data.baggage 
        : new BaggageAllowance(data.baggage || {});

      this.fareConditions = data.fareConditions instanceof FareConditions
        ? data.fareConditions
        : new FareConditions(data.fareConditions || {});

      this.priceBreakdown = data.priceBreakdown instanceof PriceBreakdown
        ? data.priceBreakdown
        : new PriceBreakdown(data.priceBreakdown || {});

      this.expiresAt = data.expiresAt || null;
      this.isExpired = Boolean(data.isExpired);
    }

    isDirect() {
      return this.segments.length === 1;
    }

    getStopsCount() {
      return this.segments.length - 1;
    }

    getOrigin() {
      return this.segments[0].origin;
    }

    getDestination() {
      return this.segments[this.segments.length - 1].destination;
    }

    getDepartureTime() {
      return this.segments[0].departureTime;
    }

    getArrivalTime() {
      return this.segments[this.segments.length - 1].arrivalTime;
    }

    getDepartureTimeString() {
      return formatISOTime(this.getDepartureTime());
    }

    getArrivalTimeString() {
      return formatISOTime(this.getArrivalTime());
    }

    getDepartureDateString() {
      return formatISODate(this.getDepartureTime());
    }

    getArrivalDateString() {
      return formatISODate(this.getArrivalTime());
    }

    isOvernight() {
      const depDate = this.getDepartureTime().split('T')[0];
      const arrDate = this.getArrivalTime().split('T')[0];
      return depDate !== arrDate;
    }

    getTotalDurationMinutes() {
      let total = 0;
      this.segments.forEach((seg, idx) => {
        total += seg.durationMinutes;
        if (idx < this.segments.length - 1 && seg.layoverAfterMinutes > 0) {
          total += seg.layoverAfterMinutes;
        }
      });
      return total;
    }

    getFormattedDuration() {
      return formatMinutesToHoursMinutes(this.getTotalDurationMinutes());
    }

    getCarrierName() {
      return this.segments[0].carrierName;
    }

    getCarrierCode() {
      return this.segments[0].carrierCode;
    }

    getCarrierLogo() {
      return this.segments[0].carrierLogo;
    }

    getFlightNumberSummary() {
      return this.segments.map(s => s.flightNumber).join(' / ');
    }

    getAircraftSummary() {
      const craftList = Array.from(new Set(this.segments.map(s => s.aircraft)));
      return craftList.join(', ');
    }

    getOperatingCarrierNote() {
      const distinctOperating = this.segments.find(s => s.hasDifferentOperatingCarrier());
      if (distinctOperating) {
        return `Operated by ${distinctOperating.operatingCarrier.name}`;
      }
      return null;
    }

    getLayoverSummary() {
      if (this.isDirect()) return 'Direct Flight';
      const layovers = [];
      this.segments.forEach((seg, idx) => {
        if (idx < this.segments.length - 1 && seg.layoverAirport) {
          layovers.push(`${formatMinutesToHoursMinutes(seg.layoverAfterMinutes)} in ${seg.layoverAirport.city} (${seg.layoverAirport.code})`);
        }
      });
      return layovers.join(', ');
    }

    /**
     * Deterministic Recommended Ranking Score:
     * Lower score = better recommendation.
     * Formula: price + (durationMinutes * 15) + (stops * 2500)
     */
    getRecommendedScore() {
      const price = this.priceBreakdown.totalAmount;
      const duration = this.getTotalDurationMinutes();
      const stops = this.getStopsCount();
      const nonRefundPenalty = this.fareConditions.isRefundable() ? 0 : 500;
      return price + (duration * 15) + (stops * 2500) + nonRefundPenalty;
    }
  }

  // -------------------------------------------------------------
  // 7. DETERMINISTIC SORTING ENGINE (DOCUMENTED ALGORITHMS)
  // -------------------------------------------------------------
  const FlightSorter = {
    /**
     * Recommended:
     * Balanced scoring function penalizing high prices, lengthy travel times,
     * and layover stops.
     */
    byRecommended(offers) {
      return [...offers].sort((a, b) => {
        const scoreDiff = a.getRecommendedScore() - b.getRecommendedScore();
        if (scoreDiff !== 0) return scoreDiff;
        // Tie-breaker 1: Price
        const priceDiff = a.priceBreakdown.totalAmount - b.priceBreakdown.totalAmount;
        if (priceDiff !== 0) return priceDiff;
        // Tie-breaker 2: Duration
        return a.getTotalDurationMinutes() - b.getTotalDurationMinutes();
      });
    },

    /**
     * Cheapest:
     * Pure ascending order of total price.
     * Tie-breaker: duration, then ID.
     */
    byCheapest(offers) {
      return [...offers].sort((a, b) => {
        const diff = a.priceBreakdown.totalAmount - b.priceBreakdown.totalAmount;
        if (diff !== 0) return diff;
        return a.getTotalDurationMinutes() - b.getTotalDurationMinutes();
      });
    },

    /**
     * Fastest:
     * Pure ascending order of total journey duration in minutes.
     * Tie-breaker: price, then ID.
     */
    byFastest(offers) {
      return [...offers].sort((a, b) => {
        const diff = a.getTotalDurationMinutes() - b.getTotalDurationMinutes();
        if (diff !== 0) return diff;
        return a.priceBreakdown.totalAmount - b.priceBreakdown.totalAmount;
      });
    },

    sort(offers, sortBy = 'recommended') {
      if (sortBy === 'cheapest') return this.byCheapest(offers);
      if (sortBy === 'fastest') return this.byFastest(offers);
      return this.byRecommended(offers);
    }
  };

  return {
    BaggageAllowance,
    FareConditions,
    PriceBreakdown,
    FlightSegment,
    FlightOffer,
    FlightSorter,
    formatMinutesToHoursMinutes,
    formatISOTime,
    formatISODate,
    formatMoney
  };
}));
