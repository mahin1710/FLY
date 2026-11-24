/**
 * FLY AVIATION - CHECKOUT STATE STORE & VALIDATION MANAGER
 * Author: mahin1710
 *
 * Coordinates the multi-step checkout journey across:
 *  1. Offer Details (/flights/offer/<id>)
 *  2. Traveller Forms (/booking/travellers)
 *  3. Extras & Ancillaries (/booking/extras)
 *  4. Review & Price Change Revalidation (/booking/review)
 *  5. Payment Placeholder (/booking/payment)
 *  6. Booking Confirmation & State Simulation (/booking/status/<ref>)
 *
 * SECURITY & PRIVACY RULES:
 *  - Strict tab-scoped sessionStorage or in-memory persistence only.
 *  - NEVER writes passport details or payment credentials to localStorage.
 *  - Transient payment details (card numbers, CVV) are never stored anywhere.
 *
 * INTEGRITY RULES:
 *  - Never generates fake airline PNRs or fake 13-digit e-ticket numbers.
 *  - Explicitly tags confirmation with <Pending Provider Connection>.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./flight_models', './flight_fixtures'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const Models = require('./flight_models');
    let Fixtures;
    try {
      Fixtures = require('./flight_fixtures');
    } catch (_) {
      Fixtures = null;
    }
    module.exports = factory(Models, Fixtures);
  } else {
    root.CheckoutStore = factory(root.FlightModels, root.FlightFixtures);
  }
}(typeof self !== 'undefined' ? self : this, function (Models, Fixtures) {
  'use strict';

  const SESSION_STORAGE_KEY = 'fly_checkout_state_v1';

  // In-memory fallback if sessionStorage is unavailable (e.g. Node tests or cookies blocked)
  let inMemoryState = null;

  // -------------------------------------------------------------
  // HELPER UTILITIES
  // -------------------------------------------------------------
  function getSessionStorage() {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage;
      }
    } catch (_) { }
    return null;
  }

  function getLocalStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch (_) { }
    return null;
  }

  function calculateAge(dobString, referenceDate = new Date()) {
    if (!dobString) return 0;
    const parts = dobString.split('-');
    if (parts.length < 3) return 0;
    const birthDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    let age = referenceDate.getFullYear() - birthDate.getFullYear();
    const monthDiff = referenceDate.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  function formatMoney(amount, currency = 'BDT') {
    const num = Number(amount) || 0;
    const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (currency === 'BDT') return `৳${formatted}`;
    if (currency === 'USD') return `$${formatted}`;
    return `${currency} ${formatted}`;
  }

  // -------------------------------------------------------------
  // DEFAULT CHECKOUT STATE TEMPLATE
  // -------------------------------------------------------------
  function createInitialState(offerId = 'DEMO-DAC-CXB-BG433') {
    return {
      version: 1,
      offerId: offerId,
      passengerCounts: {
        adults: 1,
        children: 0,
        infants: 0
      },
      travellers: [
        {
          id: 'pax-1',
          type: 'adult',
          title: 'MR',
          firstName: 'Mahin',
          lastName: 'Rahman',
          dob: '1998-05-15',
          nationality: 'BD',
          gender: 'MALE',
          idType: 'passport',
          passportNumber: 'A09876543',
          passportExpiry: '2030-05-15',
          passportCountry: 'BD',
          nid: ''
        }
      ],
      contact: {
        email: 'passenger@example.com',
        phone: '1700000000',
        countryCode: '+880'
      },
      extras: {
        selectedSeat: '12A',
        seatFee: 0,
        extraBaggage: null, // '10kg', '20kg' or null
        baggageFee: 0,
        mealOption: 'standard', // 'standard', 'hot_biryani', 'vegetarian', 'fruit', 'none'
        mealFee: 0,
        insurance: true,
        insuranceFee: 450
      },
      priceChange: {
        hasChanged: false,
        oldAmount: 0,
        newAmount: 0,
        difference: 0,
        reason: '',
        accepted: false
      },
      bookingState: 'idle', // 'idle' | 'hold_active' | 'payment_pending' | 'ticket_pending' | 'confirmed' | 'failed' | 'expired' | 'provider_unavailable'
      demoBooking: {
        reference: 'DEMO-REQ-7788',
        airlinePnr: '<Pending Provider Connection>',
        eTicketNumber: '<Not Issued - Provider Integration Required>',
        issuedAt: null,
        paymentMethod: null
      }
    };
  }

  // -------------------------------------------------------------
  // CHECKOUT STORE CLASS
  // -------------------------------------------------------------
  class CheckoutStore {
    constructor() {
      this.state = null;
      this.activeOffer = null;
      this.load();
    }

    /**
     * Load state from sessionStorage or fallback
     */
    load() {
      const storage = getSessionStorage();
      if (storage) {
        try {
          const raw = storage.getItem(SESSION_STORAGE_KEY);
          if (raw) {
            this.state = JSON.parse(raw);
            this._hydrateOffer();
            return;
          }
        } catch (_) { }
      }

      if (inMemoryState) {
        this.state = JSON.parse(JSON.stringify(inMemoryState));
      } else {
        this.state = createInitialState();
      }
      this._hydrateOffer();
    }

    /**
     * Save state to sessionStorage (tab-scoped) and in-memory.
     * STRICT SECURITY RULE: Absolutely NEVER writes to localStorage.
     */
    save() {
      if (!this.state) return;

      // Security check: Never put passport or payment in localStorage
      const local = getLocalStorage();
      if (local) {
        // Assert local storage has no checkout keys
        local.removeItem(SESSION_STORAGE_KEY);
        local.removeItem('fly_passport');
        local.removeItem('fly_card');
      }

      const serializable = JSON.stringify(this.state);
      const storage = getSessionStorage();
      if (storage) {
        try {
          storage.setItem(SESSION_STORAGE_KEY, serializable);
        } catch (_) { }
      }
      inMemoryState = JSON.parse(serializable);
    }

    /**
     * Hydrate FlightOffer instance from Fixtures or Models
     */
    _hydrateOffer() {
      const offerId = this.state.offerId;
      if (Fixtures && typeof Fixtures.getOfferById === 'function') {
        this.activeOffer = Fixtures.getOfferById(offerId);
      }
      if (!this.activeOffer && Fixtures && Fixtures.DEMO_OFFERS && Fixtures.DEMO_OFFERS.length > 0) {
        this.activeOffer = Fixtures.DEMO_OFFERS[0];
      }
    }

    /**
     * Initialize or switch to a specific offer ID
     */
    initOffer(offerId, searchParams = {}) {
      if (!this.state) {
        this.state = createInitialState(offerId);
      } else {
        this.state.offerId = offerId;
      }

      // Sync passenger counts if passed in query params
      if (searchParams.adults !== undefined || searchParams.children !== undefined || searchParams.infants !== undefined) {
        const adults = Math.max(1, parseInt(searchParams.adults || 1, 10));
        const children = Math.max(0, parseInt(searchParams.children || 0, 10));
        const infants = Math.max(0, parseInt(searchParams.infants || 0, 10));
        this.setPassengerCounts(adults, children, infants);
      }

      this._hydrateOffer();
      this.save();
      return this.activeOffer;
    }

    getOffer() {
      if (!this.activeOffer) {
        this._hydrateOffer();
      }
      return this.activeOffer;
    }

    getOfferId() {
      return this.state ? this.state.offerId : 'DEMO-DAC-CXB-BG433';
    }

    // -----------------------------------------------------------
    // PASSENGER & TRAVELLER STATE MANAGEMENT
    // -----------------------------------------------------------
    getPassengerCounts() {
      return this.state.passengerCounts;
    }

    setPassengerCounts(adults, children = 0, infants = 0) {
      adults = Math.max(1, parseInt(adults, 10) || 1);
      children = Math.max(0, parseInt(children, 10) || 0);
      infants = Math.max(0, parseInt(infants, 10) || 0);

      this.state.passengerCounts = { adults, children, infants };
      this._syncTravellersListWithCounts();
      this.save();
    }

    _syncTravellersListWithCounts() {
      const { adults, children, infants } = this.state.passengerCounts;
      const current = this.state.travellers || [];
      const updated = [];

      let adultIdx = 0, childIdx = 0, infantIdx = 0;

      // Adults
      for (let i = 0; i < adults; i++) {
        const existing = current.find(p => p.type === 'adult' && p._idx === i) ||
          current.filter(p => p.type === 'adult')[i];
        if (existing) {
          existing._idx = i;
          updated.push(existing);
        } else {
          updated.push({
            id: `pax-adult-${i + 1}`,
            type: 'adult',
            _idx: i,
            title: i === 0 ? 'MR' : 'MS',
            firstName: i === 0 ? 'Mahin' : '',
            lastName: i === 0 ? 'Rahman' : '',
            dob: i === 0 ? '1998-05-15' : '1995-01-01',
            nationality: 'BD',
            gender: 'MALE',
            idType: 'passport',
            passportNumber: i === 0 ? 'A09876543' : '',
            passportExpiry: i === 0 ? '2030-05-15' : '',
            passportCountry: 'BD',
            nid: ''
          });
        }
        adultIdx++;
      }

      // Children
      for (let i = 0; i < children; i++) {
        const existing = current.filter(p => p.type === 'child')[i];
        if (existing) {
          existing._idx = i;
          updated.push(existing);
        } else {
          updated.push({
            id: `pax-child-${i + 1}`,
            type: 'child',
            _idx: i,
            title: 'MSTR',
            firstName: '',
            lastName: '',
            dob: '2018-06-10', // ~8 years old
            nationality: 'BD',
            gender: 'MALE',
            idType: 'passport',
            passportNumber: '',
            passportExpiry: '',
            passportCountry: 'BD',
            nid: ''
          });
        }
        childIdx++;
      }

      // Infants
      for (let i = 0; i < infants; i++) {
        const existing = current.filter(p => p.type === 'infant')[i];
        if (existing) {
          existing._idx = i;
          updated.push(existing);
        } else {
          updated.push({
            id: `pax-infant-${i + 1}`,
            type: 'infant',
            _idx: i,
            title: 'INF',
            firstName: '',
            lastName: '',
            dob: '2025-01-15', // ~1 year old
            nationality: 'BD',
            gender: 'FEMALE',
            idType: 'passport',
            passportNumber: '',
            passportExpiry: '',
            passportCountry: 'BD',
            nid: ''
          });
        }
        infantIdx++;
      }

      this.state.travellers = updated;
    }

    getTravellers() {
      return this.state.travellers || [];
    }

    setTravellers(travellers) {
      if (Array.isArray(travellers)) {
        this.state.travellers = travellers;
        this.save();
      }
    }

    updateTraveller(index, patch) {
      if (this.state.travellers && this.state.travellers[index]) {
        Object.assign(this.state.travellers[index], patch);
        this.save();
      }
    }

    getContact() {
      return this.state.contact;
    }

    setContact(contact) {
      this.state.contact = Object.assign({}, this.state.contact, contact);
      this.save();
    }

    // -----------------------------------------------------------
    // VALIDATION RULES (AGE, ROUTE, PASSPORT)
    // -----------------------------------------------------------
    isInternationalRoute() {
      const offer = this.getOffer();
      if (offer && typeof offer.isInternationalRoute === 'function') {
        return offer.isInternationalRoute();
      }
      return false; // Default domestic
    }

    validateTraveller(traveller, isInternational = null) {
      if (isInternational === null) {
        isInternational = this.isInternationalRoute();
      }

      const errors = {};
      const prefix = traveller.id || 'traveller';

      // 1. Name validation
      if (!traveller.firstName || traveller.firstName.trim().length < 2) {
        errors[`${prefix}_firstName`] = 'First name is required (min 2 letters).';
      }
      if (!traveller.lastName || traveller.lastName.trim().length < 2) {
        errors[`${prefix}_lastName`] = 'Last / surname is required (min 2 letters).';
      }

      // 2. Date of Birth & Age Bracket Validation
      if (!traveller.dob) {
        errors[`${prefix}_dob`] = 'Date of birth is required.';
      } else {
        const age = calculateAge(traveller.dob);
        if (traveller.type === 'adult' && age < 12) {
          errors[`${prefix}_dob`] = `Adult passenger must be 12 years or older (current: ${age}y).`;
        } else if (traveller.type === 'child' && (age < 2 || age >= 12)) {
          errors[`${prefix}_dob`] = `Child passenger must be between 2 and 11 years old (current: ${age}y).`;
        } else if (traveller.type === 'infant' && age >= 2) {
          errors[`${prefix}_dob`] = `Infant passenger must be under 2 years old (current: ${age}y).`;
        }
      }

      // 3. Document / Passport Validation
      if (isInternational) {
        // Strict international rules: Passport is mandatory
        if (!traveller.passportNumber || traveller.passportNumber.trim().length < 6) {
          errors[`${prefix}_passportNumber`] = 'Passport number is required for international flights (min 6 alphanumeric characters).';
        }
        if (!traveller.passportCountry) {
          errors[`${prefix}_passportCountry`] = 'Passport issuing country is required for international routes.';
        }
        if (!traveller.passportExpiry) {
          errors[`${prefix}_passportExpiry`] = 'Passport expiry date is required.';
        } else {
          const expDate = new Date(traveller.passportExpiry);
          const now = new Date();
          if (expDate <= now) {
            errors[`${prefix}_passportExpiry`] = 'Passport has expired. Valid passport required.';
          }
        }
      } else {
        // Domestic flight: Passport is optional. If provided, check minimum length.
        if (traveller.passportNumber && traveller.passportNumber.trim().length > 0 && traveller.passportNumber.trim().length < 4) {
          errors[`${prefix}_passportNumber`] = 'Enter a valid Passport or NID number (or leave blank for domestic check-in).';
        }
      }

      return {
        isValid: Object.keys(errors).length === 0,
        errors
      };
    }

    validateAllTravellers() {
      const isInternational = this.isInternationalRoute();
      let allErrors = {};
      let isValid = true;

      const travellers = this.getTravellers();
      travellers.forEach(traveller => {
        const result = this.validateTraveller(traveller, isInternational);
        if (!result.isValid) {
          isValid = false;
          Object.assign(allErrors, result.errors);
        }
      });

      // Contact validation
      const contact = this.getContact();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!contact.email || !emailRegex.test(contact.email)) {
        allErrors['contact_email'] = 'A valid contact email address is required for booking confirmation.';
        isValid = false;
      }
      if (!contact.phone || contact.phone.replace(/\D/g, '').length < 7) {
        allErrors['contact_phone'] = 'A valid mobile phone number is required for SMS updates.';
        isValid = false;
      }

      return {
        isValid,
        errors: allErrors
      };
    }

    // -----------------------------------------------------------
    // EXTRAS & ANCILLARY MANAGEMENT
    // -----------------------------------------------------------
    getExtras() {
      return this.state.extras;
    }

    setExtras(extrasPatch) {
      const offer = this.getOffer();
      const supported = (offer && offer.supportedExtras) ? offer.supportedExtras : {
        seatSelection: true,
        extraBaggage: true,
        mealSelection: true
      };

      const updated = Object.assign({}, this.state.extras, extrasPatch);

      // Enforce provider support constraints:
      if (!supported.seatSelection) {
        updated.selectedSeat = null;
        updated.seatFee = 0;
      }

      if (!supported.extraBaggage) {
        updated.extraBaggage = null;
        updated.baggageFee = 0;
      } else {
        if (updated.extraBaggage === '10kg') updated.baggageFee = 1200;
        else if (updated.extraBaggage === '20kg') updated.baggageFee = 2200;
        else updated.baggageFee = 0;
      }

      if (!supported.mealSelection) {
        updated.mealOption = 'standard';
        updated.mealFee = 0;
      } else {
        if (updated.mealOption === 'hot_biryani') updated.mealFee = 650;
        else if (updated.mealOption === 'vegetarian') updated.mealFee = 650;
        else if (updated.mealOption === 'fruit') updated.mealFee = 450;
        else updated.mealFee = 0;
      }

      if (updated.insurance) {
        updated.insuranceFee = 450;
      } else {
        updated.insuranceFee = 0;
      }

      this.state.extras = updated;
      this.save();
      return this.state.extras;
    }

    // -----------------------------------------------------------
    // PRICING & BREAKDOWN CALCULATION
    // -----------------------------------------------------------
    calculateBreakdown() {
      const offer = this.getOffer();
      const currency = offer ? offer.priceBreakdown.currency : 'BDT';
      const basePerAdult = offer ? offer.priceBreakdown.baseFare : 3600;
      const taxesPerAdult = offer ? (offer.priceBreakdown.taxes + offer.priceBreakdown.airlineFees) : 900;

      const { adults, children, infants } = this.state.passengerCounts;

      // Children pay 80% base fare, same taxes; Infants pay 10% base, no tax
      const childBaseFare = Math.round(basePerAdult * 0.80);
      const infantBaseFare = Math.round(basePerAdult * 0.10);

      const totalAdultsBase = basePerAdult * adults;
      const totalChildrenBase = childBaseFare * children;
      const totalInfantsBase = infantBaseFare * infants;
      const totalBaseFare = totalAdultsBase + totalChildrenBase + totalInfantsBase;

      const totalTaxes = (taxesPerAdult * adults) + (taxesPerAdult * children);

      const extras = this.getExtras();
      const baggageFee = extras.baggageFee || 0;
      const mealFee = extras.mealFee || 0;
      const seatFee = extras.seatFee || 0;
      const insuranceFee = extras.insurance ? (extras.insuranceFee || 450) : 0;
      const totalAncillaries = baggageFee + mealFee + seatFee + insuranceFee;

      let subtotal = totalBaseFare + totalTaxes + totalAncillaries;

      // If price change is active and accepted, adjust
      if (this.state.priceChange && this.state.priceChange.hasChanged) {
        // Adjust for price change difference
        subtotal += this.state.priceChange.difference;
      }

      return {
        currency,
        adultsCount: adults,
        childrenCount: children,
        infantsCount: infants,
        basePerAdult,
        childBaseFare,
        infantBaseFare,
        totalAdultsBase,
        totalChildrenBase,
        totalInfantsBase,
        totalBaseFare,
        taxesPerAdult,
        totalTaxes,
        baggageFee,
        mealFee,
        seatFee,
        insuranceFee,
        totalAncillaries,
        grandTotal: Math.max(0, subtotal)
      };
    }

    // -----------------------------------------------------------
    // PRICE CHANGE REVALIDATION HANDLING
    // -----------------------------------------------------------
    simulatePriceChange(newAmount, reason = 'Airline fare bucket expired; updated to next available booking class.') {
      this.clearPriceChange();
      const breakdown = this.calculateBreakdown();
      const oldAmount = breakdown.grandTotal;
      const difference = newAmount - oldAmount;

      this.state.priceChange = {
        hasChanged: true,
        oldAmount,
        newAmount,
        difference,
        reason,
        accepted: false
      };
      this.save();
      return this.state.priceChange;
    }

    acceptPriceChange() {
      if (this.state.priceChange) {
        this.state.priceChange.accepted = true;
        this.save();
      }
    }

    clearPriceChange() {
      this.state.priceChange = {
        hasChanged: false,
        oldAmount: 0,
        newAmount: 0,
        difference: 0,
        reason: '',
        accepted: false
      };
      this.save();
    }

    hasPendingPriceChange() {
      return Boolean(this.state.priceChange && this.state.priceChange.hasChanged && !this.state.priceChange.accepted);
    }

    // -----------------------------------------------------------
    // BOOKING STATE & CONFIRMATION
    // -----------------------------------------------------------
    getBookingState() {
      return this.state.bookingState;
    }

    setBookingState(state) {
      const validStates = ['idle', 'hold_active', 'payment_pending', 'ticket_pending', 'confirmed', 'failed', 'expired', 'provider_unavailable'];
      if (validStates.includes(state)) {
        this.state.bookingState = state;
        this.save();
      }
    }

    completeDemoPayment(method = 'instant') {
      const randRef = 'DEMO-REQ-' + Math.floor(1000 + Math.random() * 9000);
      this.state.bookingState = 'confirmed';
      this.state.demoBooking = {
        reference: randRef,
        // STRICT INTEGRITY: No fake airline PNR or fake 13-digit e-ticket
        airlinePnr: '<Pending Provider Connection>',
        eTicketNumber: '<Not Issued - Provider Integration Required>',
        issuedAt: new Date().toISOString(),
        paymentMethod: method,
        isSimulated: true
      };
      this.save();
      return this.state.demoBooking;
    }

    getDemoBooking() {
      return this.state.demoBooking;
    }

    /**
     * Security Audit Check: Verify zero sensitive data stored in localStorage
     */
    verifyZeroSensitiveDataInLocalStorage() {
      const local = getLocalStorage();
      if (!local) return { passed: true, details: 'localStorage unavailable or empty' };

      const forbiddenKeys = ['passport', 'card', 'cvv', 'password', 'payment', SESSION_STORAGE_KEY];
      const violations = [];

      for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (key) {
          const lower = key.toLowerCase();
          for (const f of forbiddenKeys) {
            if (lower.includes(f)) {
              violations.push(key);
            }
          }
        }
      }

      return {
        passed: violations.length === 0,
        violations,
        details: violations.length === 0 ? 'Verified: Zero sensitive traveller/payment data in localStorage' : `Violations found: ${violations.join(', ')}`
      };
    }

    /**
     * Clear checkout session
     */
    reset() {
      const storage = getSessionStorage();
      if (storage) {
        try {
          storage.removeItem(SESSION_STORAGE_KEY);
        } catch (_) { }
      }
      inMemoryState = null;
      this.state = createInitialState();
      this._hydrateOffer();
    }
  }

  // Singleton instance
  const storeInstance = new CheckoutStore();

  return {
    CheckoutStore,
    instance: storeInstance,
    calculateAge,
    formatMoney
  };
}));
