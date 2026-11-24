/**
 * FLY AVIATION - TYPED DEMO FLIGHT FIXTURES
 * Author: mahin1710
 *
 * Provides typed, deterministic DEMO fixtures for search results.
 * Each fixture is normalized via FlightModels and tagged with:
 * "Demo data – not bookable".
 *
 * Covers:
 *  - Direct flights
 *  - Connecting flights with 1+ stops & layovers
 *  - Overnight flights (+1 day arrival)
 *  - Operating vs Marketing carrier divergence
 *  - Cabin-only vs Checked baggage
 *  - Refundable vs Non-refundable
 *  - Expired / Timeout state demo fixtures
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./flight_models'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const Models = require('./flight_models');
    module.exports = factory(Models);
  } else {
    root.FlightFixtures = factory(root.FlightModels);
  }
}(typeof self !== 'undefined' ? self : this, function (Models) {
  'use strict';

  const { FlightOffer, FlightSegment, BaggageAllowance, FareConditions, PriceBreakdown } = Models;

  // Base dates (dynamic relative to local today)
  function getIsoDate(offsetDays = 0) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const d0 = getIsoDate(3); // Dep date +3 days
  const d1 = getIsoDate(4); // +4 days (next day for overnight)

  const RAW_FIXTURES = [
    // -------------------------------------------------------------
    // 1. BIMAN BANGLADESH AIRLINES (Direct, Morning, Refundable)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-CXB-BG433',
      segments: [
        {
          id: 'SEG-BG433-1',
          carrierCode: 'BG',
          carrierName: 'Biman Bangladesh Airlines',
          carrierLogo: '✈️',
          flightNumber: 'BG-433',
          marketingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          operatingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          aircraft: 'Boeing 737-800',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Terminal 1' },
          destination: { code: 'CXB', city: "Cox's Bazar", airport: "Cox's Bazar Airport", terminal: 'Main Terminal' },
          departureTime: `${d0}T10:30:00`,
          arrivalTime: `${d0}T11:25:00`,
          durationMinutes: 55,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 1,
        checkedWeightKg: 20
      },
      fareConditions: {
        refundable: true,
        refundableWithFee: false,
        changeable: true,
        cancellationFee: 800,
        changeFee: 500,
        fareFamily: 'Economy Flex',
        refundPolicyText: 'Refundable up to 24h prior to departure (Fee: ৳800)'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 3600,
        taxes: 650,
        airlineFees: 250,
        serviceFee: 0,
        discount: 0,
        totalAmount: 4500
      }
    },

    // -------------------------------------------------------------
    // 2. US-BANGLA AIRLINES (Direct, Afternoon, Non-refundable)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-CXB-BS141',
      segments: [
        {
          id: 'SEG-BS141-1',
          carrierCode: 'BS',
          carrierName: 'US-Bangla Airlines',
          carrierLogo: '🛫',
          flightNumber: 'BS-141',
          marketingCarrier: { code: 'BS', name: 'US-Bangla Airlines' },
          operatingCarrier: { code: 'BS', name: 'US-Bangla Airlines' },
          aircraft: 'ATR 72-600',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Domestic Terminal' },
          destination: { code: 'CXB', city: "Cox's Bazar", airport: "Cox's Bazar Airport", terminal: 'Main Terminal' },
          departureTime: `${d0}T14:15:00`,
          arrivalTime: `${d0}T15:15:00`,
          durationMinutes: 60,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 1,
        checkedWeightKg: 20
      },
      fareConditions: {
        refundable: false,
        refundableWithFee: false,
        changeable: true,
        cancellationFee: 0,
        changeFee: 1200,
        fareFamily: 'Economy Standard',
        refundPolicyText: 'Non-refundable ticket. Date changes permitted with fee.'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 3900,
        taxes: 650,
        airlineFees: 250,
        serviceFee: 0,
        discount: 0,
        totalAmount: 4800
      }
    },

    // -------------------------------------------------------------
    // 3. AIR ASTRA (Direct, Evening, Cheapest, Refundable with Fee)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-CXB-2A441',
      segments: [
        {
          id: 'SEG-2A441-1',
          carrierCode: '2A',
          carrierName: 'Air Astra',
          carrierLogo: '✨',
          flightNumber: '2A-441',
          marketingCarrier: { code: '2A', name: 'Air Astra' },
          operatingCarrier: { code: '2A', name: 'Air Astra' },
          aircraft: 'ATR 72-600',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Domestic Terminal' },
          destination: { code: 'CXB', city: "Cox's Bazar", airport: "Cox's Bazar Airport", terminal: 'Main Terminal' },
          departureTime: `${d0}T17:40:00`,
          arrivalTime: `${d0}T18:35:00`,
          durationMinutes: 55,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 1,
        checkedWeightKg: 20
      },
      fareConditions: {
        refundable: false,
        refundableWithFee: true,
        changeable: true,
        cancellationFee: 1000,
        changeFee: 600,
        fareFamily: 'Economy Saver',
        refundPolicyText: 'Refundable with standard airline fee (৳1,000)'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 3400,
        taxes: 600,
        airlineFees: 250,
        serviceFee: 0,
        discount: 0,
        totalAmount: 4250
      }
    },

    // -------------------------------------------------------------
    // 4. US-BANGLA AIRLINES (Cabin-Only / Budget Light Fare)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-CXB-BS149',
      segments: [
        {
          id: 'SEG-BS149-1',
          carrierCode: 'BS',
          carrierName: 'US-Bangla Airlines',
          carrierLogo: '🛫',
          flightNumber: 'BS-149',
          marketingCarrier: { code: 'BS', name: 'US-Bangla Airlines' },
          operatingCarrier: { code: 'BS', name: 'US-Bangla Airlines' },
          aircraft: 'Boeing 737-800',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Domestic Terminal' },
          destination: { code: 'CXB', city: "Cox's Bazar", airport: "Cox's Bazar Airport", terminal: 'Main Terminal' },
          departureTime: `${d0}T20:30:00`,
          arrivalTime: `${d0}T21:30:00`,
          durationMinutes: 60,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 0,
        checkedWeightKg: 0 // Cabin baggage only
      },
      fareConditions: {
        refundable: false,
        refundableWithFee: false,
        changeable: false,
        cancellationFee: 0,
        changeFee: 0,
        fareFamily: 'Super Saver Light',
        refundPolicyText: 'Strictly non-refundable, non-changeable hand-baggage only ticket'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 3100,
        taxes: 600,
        airlineFees: 250,
        serviceFee: 0,
        discount: 0,
        totalAmount: 3950
      }
    },

    // -------------------------------------------------------------
    // 5. CONNECTING FLIGHT: Biman Bangladesh via Chittagong (CGP)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-CXB-BG409-CONNECT',
      segments: [
        {
          id: 'SEG-BG409-1',
          carrierCode: 'BG',
          carrierName: 'Biman Bangladesh Airlines',
          carrierLogo: '✈️',
          flightNumber: 'BG-409',
          marketingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          operatingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          aircraft: 'Boeing 737-800',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Terminal 1' },
          destination: { code: 'CGP', city: 'Chittagong', airport: 'Shah Amanat International Airport', terminal: 'Main Terminal' },
          departureTime: `${d0}T08:00:00`,
          arrivalTime: `${d0}T08:45:00`,
          durationMinutes: 45,
          layoverAfterMinutes: 75,
          layoverAirport: { code: 'CGP', city: 'Chittagong', airport: 'Shah Amanat International Airport' }
        },
        {
          id: 'SEG-BG409-2',
          carrierCode: 'BG',
          carrierName: 'Biman Bangladesh Airlines',
          carrierLogo: '✈️',
          flightNumber: 'BG-411',
          marketingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          operatingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          aircraft: 'Boeing 737-800',
          cabinClass: 'Economy',
          origin: { code: 'CGP', city: 'Chittagong', airport: 'Shah Amanat International Airport', terminal: 'Main Terminal' },
          destination: { code: 'CXB', city: "Cox's Bazar", airport: "Cox's Bazar Airport", terminal: 'Main Terminal' },
          departureTime: `${d0}T10:00:00`,
          arrivalTime: `${d0}T10:35:00`,
          durationMinutes: 35,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 1,
        checkedWeightKg: 20
      },
      fareConditions: {
        refundable: true,
        refundableWithFee: false,
        changeable: true,
        cancellationFee: 500,
        changeFee: 400,
        fareFamily: 'Economy Flex',
        refundPolicyText: 'Fully refundable with transit baggage check-through'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 4200,
        taxes: 950,
        airlineFees: 350,
        serviceFee: 0,
        discount: 0,
        totalAmount: 5500
      }
    },

    // -------------------------------------------------------------
    // 6. OVERNIGHT FLIGHT: Biman Bangladesh (+1 Day Arrival)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-DXB-BG051-OVERNIGHT',
      segments: [
        {
          id: 'SEG-BG051-1',
          carrierCode: 'BG',
          carrierName: 'Biman Bangladesh Airlines',
          carrierLogo: '✈️',
          flightNumber: 'BG-051',
          marketingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          operatingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          aircraft: 'Boeing 787-8 Dreamliner',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Terminal 2' },
          destination: { code: 'DXB', city: 'Dubai', airport: 'Dubai International Airport', terminal: 'Terminal 1' },
          departureTime: `${d0}T23:45:00`,
          arrivalTime: `${d1}T04:30:00`, // Overnights into d1
          durationMinutes: 315,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 2,
        checkedWeightKg: 30
      },
      fareConditions: {
        refundable: true,
        refundableWithFee: false,
        changeable: true,
        cancellationFee: 2500,
        changeFee: 1500,
        fareFamily: 'International Economy Saver',
        refundPolicyText: 'Refundable up to 48h prior to international departure'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 29000,
        taxes: 5200,
        airlineFees: 1800,
        serviceFee: 0,
        discount: 0,
        totalAmount: 36000
      }
    },

    // -------------------------------------------------------------
    // 7. OPERATING CARRIER DIVERGENCE: Emirates marketed, flydubai operated
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-DXB-FZ584-CODESHARE',
      segments: [
        {
          id: 'SEG-FZ584-1',
          carrierCode: 'EK',
          carrierName: 'Emirates',
          carrierLogo: '🇦🇪',
          flightNumber: 'EK-2041',
          marketingCarrier: { code: 'EK', name: 'Emirates' },
          operatingCarrier: { code: 'FZ', name: 'flydubai' },
          aircraft: 'Boeing 737 MAX 8',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Terminal 2' },
          destination: { code: 'DXB', city: 'Dubai', airport: 'Dubai International Airport', terminal: 'Terminal 2' },
          departureTime: `${d0}T13:30:00`,
          arrivalTime: `${d0}T17:00:00`,
          durationMinutes: 270,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 1,
        checkedWeightKg: 20
      },
      fareConditions: {
        refundable: false,
        refundableWithFee: true,
        changeable: true,
        cancellationFee: 3500,
        changeFee: 2000,
        fareFamily: 'Economy Value',
        refundPolicyText: 'Refundable with fees via partner carrier policy'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 33500,
        taxes: 5500,
        airlineFees: 2000,
        serviceFee: 0,
        discount: 0,
        totalAmount: 41000
      }
    },

    // -------------------------------------------------------------
    // 8. PREMIUM CARRIER: Emirates Direct Luxury
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-DXB-EK583-NONSTOP',
      segments: [
        {
          id: 'SEG-EK583-1',
          carrierCode: 'EK',
          carrierName: 'Emirates',
          carrierLogo: '🇦🇪',
          flightNumber: 'EK-583',
          marketingCarrier: { code: 'EK', name: 'Emirates' },
          operatingCarrier: { code: 'EK', name: 'Emirates' },
          aircraft: 'Boeing 777-300ER',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport', terminal: 'Terminal 2' },
          destination: { code: 'DXB', city: 'Dubai', airport: 'Dubai International Airport', terminal: 'Terminal 3' },
          departureTime: `${d0}T09:55:00`,
          arrivalTime: `${d0}T13:10:00`,
          durationMinutes: 255,
          layoverAfterMinutes: 0
        }
      ],
      baggage: {
        cabinPieces: 1,
        cabinWeightKg: 7,
        checkedPieces: 2,
        checkedWeightKg: 30
      },
      fareConditions: {
        refundable: true,
        refundableWithFee: false,
        changeable: true,
        cancellationFee: 2000,
        changeFee: 0,
        fareFamily: 'Economy Flex Plus',
        refundPolicyText: 'Free date change & refundable prior to flight departure'
      },
      priceBreakdown: {
        currency: 'BDT',
        baseFare: 43000,
        taxes: 6800,
        airlineFees: 2200,
        serviceFee: 0,
        discount: 0,
        totalAmount: 52000
      }
    },

    // -------------------------------------------------------------
    // 9. EXPIRED DEMO FIXTURE (For testing expired offer states)
    // -------------------------------------------------------------
    {
      id: 'DEMO-DAC-CXB-EXPIRED',
      isExpired: true,
      segments: [
        {
          id: 'SEG-EXPIRED-1',
          carrierCode: 'BG',
          carrierName: 'Biman Bangladesh Airlines',
          carrierLogo: '✈️',
          flightNumber: 'BG-999',
          marketingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          operatingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
          aircraft: 'Boeing 737-800',
          cabinClass: 'Economy',
          origin: { code: 'DAC', city: 'Dhaka', airport: 'Hazrat Shahjalal International Airport' },
          destination: { code: 'CXB', city: "Cox's Bazar", airport: "Cox's Bazar Airport" },
          departureTime: `${getIsoDate(-1)}T10:00:00`,
          arrivalTime: `${getIsoDate(-1)}T11:00:00`,
          durationMinutes: 60
        }
      ],
      baggage: { cabinPieces: 1, cabinWeightKg: 7, checkedPieces: 1, checkedWeightKg: 20 },
      fareConditions: { refundable: false, fareFamily: 'Expired Fare' },
      priceBreakdown: { currency: 'BDT', totalAmount: 3800 }
    }
  ];

  // Instantiated normalized FlightOffer objects
  const DEMO_OFFERS = RAW_FIXTURES.map(raw => new FlightOffer(raw));

  /**
   * Filter and query demo fixtures by criteria
   */
  function queryDemoOffers(params = {}) {
    const fromCode = (params.from || '').toUpperCase();
    const toCode = (params.to || '').toUpperCase();

    let matching = DEMO_OFFERS.filter(offer => !offer.isExpired);

    // If route specified, filter by route; if no exact match, return all valid demo offers for exploration
    if (fromCode && toCode) {
      const routeMatches = matching.filter(offer => {
        const orig = offer.getOrigin().code;
        const dest = offer.getDestination().code;
        return (orig === fromCode && dest === toCode);
      });
      if (routeMatches.length > 0) {
        matching = routeMatches;
      }
    }

    return matching;
  }

  function getOfferById(id) {
    return DEMO_OFFERS.find(o => o.id === id) || null;
  }

  return {
    DEMO_OFFERS,
    queryDemoOffers,
    getOfferById
  };
}));
