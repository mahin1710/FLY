/**
 * FLY AVIATION - FLIGHT SEARCH WIDGET SYSTEM
 * Author: mahin1710
 * Features:
 * 1. Trip Types: Round Trip, One Way, Multi City
 * 2. Autocomplete: Offline local catalog + live SQLite search
 * 3. Swap: Smooth Origin/Destination exchange with validation
 * 4. Date Constraints: Local date enforcement, past date prevention, return >= departure
 * 5. Configurable Validation: Infant-to-adult ratio, child/infant age brackets, passenger limits
 * 6. Accessibility: Inline ARIA alerts, aria-invalid, screen-reader descriptions
 * 7. State Persistence: sessionStorage serialization & restoration on browser back navigation
 * 8. Safe Query Encoding: Strongly-typed query string construction for results page
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FlightSearchWidget = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------------------------------------------------------------
  // 1. CONFIGURABLE VALIDATION & AIRLINE RULES CONFIG
  // -------------------------------------------------------------
  const SEARCH_CONFIG = {
    minAdults: 1,
    maxAdults: 9,
    maxChildren: 8,
    maxInfants: 4,
    maxTotalPassengers: 9,
    maxInfantsPerAdult: 1, // IATA lap infant safety rule: 1 infant per adult
    minMultiCityLegs: 2,
    maxMultiCityLegs: 5,
    childAgeMin: 2,
    childAgeMax: 11,
    infantAgeMax: 2, // Under 2
    cabinClasses: ['Economy', 'Premium Economy', 'Business', 'First Class'],
    storageKey: 'fly_search_state_v1'
  };

  // -------------------------------------------------------------
  // 2. LOCAL VERIFIED AIRPORT REFERENCE CATALOG (OFFLINE FALLBACK)
  // -------------------------------------------------------------
  const LOCAL_AIRPORT_CATALOG = [
    { id: 1, city: 'Dhaka', IATA: 'DAC', ICAO: 'VGHS', name: 'Hazrat Shahjalal International Airport', country: 'Bangladesh' },
    { id: 2, city: "Cox's Bazar", IATA: 'CXB', ICAO: 'VGCB', name: "Cox's Bazar Airport", country: 'Bangladesh' },
    { id: 3, city: 'Chittagong', IATA: 'CGP', ICAO: 'VGEG', name: 'Shah Amanat International Airport', country: 'Bangladesh' },
    { id: 4, city: 'Sylhet', IATA: 'ZYL', ICAO: 'VGSY', name: 'Osmani International Airport', country: 'Bangladesh' },
    { id: 5, city: 'Jessore', IATA: 'JSR', ICAO: 'VGJR', name: 'Jashore Airport', country: 'Bangladesh' },
    { id: 6, city: 'Barisal', IATA: 'BZL', ICAO: 'VGBR', name: 'Barisal Airport', country: 'Bangladesh' },
    { id: 7, city: 'Saidpur', IATA: 'SPD', ICAO: 'VGSD', name: 'Saidpur Airport', country: 'Bangladesh' },
    { id: 8, city: 'Rajshahi', IATA: 'RJH', ICAO: 'VGRJ', name: 'Shah Makhdum Airport', country: 'Bangladesh' },
    { id: 9, city: 'Dubai', IATA: 'DXB', ICAO: 'OMDB', name: 'Dubai International Airport', country: 'United Arab Emirates' },
    { id: 10, city: 'Bangkok', IATA: 'BKK', ICAO: 'VTBS', name: 'Suvarnabhumi Airport', country: 'Thailand' },
    { id: 11, city: 'Singapore', IATA: 'SIN', ICAO: 'WSSS', name: 'Singapore Changi Airport', country: 'Singapore' },
    { id: 12, city: 'Kuala Lumpur', IATA: 'KUL', ICAO: 'WMKK', name: 'Kuala Lumpur International Airport', country: 'Malaysia' },
    { id: 13, city: 'London', IATA: 'LHR', ICAO: 'EGLL', name: 'Heathrow Airport', country: 'United Kingdom' },
    { id: 14, city: 'New York', IATA: 'JFK', ICAO: 'KJFK', name: 'John F. Kennedy International Airport', country: 'United States' },
    { id: 15, city: 'Jeddah', IATA: 'JED', ICAO: 'OEJN', name: 'King Abdulaziz International Airport', country: 'Saudi Arabia' }
  ];

  // -------------------------------------------------------------
  // 3. UTILITY FUNCTIONS
  // -------------------------------------------------------------
  function getLocalDateString(offsetDays = 0) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseAirportCode(inputStr) {
    if (!inputStr) return '';
    const match = inputStr.match(/\(([A-Z]{3})\)/i);
    if (match) return match[1].toUpperCase();
    const words = inputStr.trim().split(/\s+/);
    for (const w of words) {
      if (w.length === 3 && /^[A-Za-z]{3}$/.test(w)) return w.toUpperCase();
    }
    const clean = inputStr.trim().toLowerCase();
    const found = LOCAL_AIRPORT_CATALOG.find(a => 
      a.city.toLowerCase() === clean || 
      (a.IATA && a.IATA.toLowerCase() === clean) ||
      a.name.toLowerCase() === clean
    );
    if (found) return found.IATA || found.ICAO;
    return '';
  }

  function parseCityName(inputStr) {
    if (!inputStr) return '';
    const clean = inputStr.replace(/\([A-Z]{3}\)/i, '').trim();
    if (clean) return clean;
    const found = LOCAL_AIRPORT_CATALOG.find(a => a.IATA && a.IATA.toLowerCase() === inputStr.trim().toLowerCase());
    if (found) return found.city;
    return inputStr.trim();
  }

  // -------------------------------------------------------------
  // 4. MAIN WIDGET CONTROLLER
  // -------------------------------------------------------------
  const FlightSearchWidget = {
    config: SEARCH_CONFIG,
    catalog: LOCAL_AIRPORT_CATALOG,
    state: {
      tripType: 'roundtrip',
      origin: { city: 'Dhaka', code: 'DAC', raw: 'Dhaka (DAC)' },
      destination: { city: "Cox's Bazar", code: 'CXB', raw: "Cox's Bazar (CXB)" },
      depDate: '',
      returnDate: '',
      passengers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'Economy',
      multiCityLegs: [
        { from: 'Dhaka (DAC)', fromCity: 'Dhaka', fromCode: 'DAC', to: 'Chittagong (CGP)', toCity: 'Chittagong', toCode: 'CGP', date: '' },
        { from: 'Chittagong (CGP)', fromCity: 'Chittagong', fromCode: 'CGP', to: "Cox's Bazar (CXB)", toCity: "Cox's Bazar", toCode: 'CXB', date: '' }
      ],
      isSubmitting: false
    },

    // -----------------------------------------------------------
    // INITIALIZATION
    // -----------------------------------------------------------
    init() {
      // Set default dates if empty: Departure = today + 3 days, Return = today + 7 days
      if (!this.state.depDate) {
        this.state.depDate = getLocalDateString(3);
      }
      if (!this.state.returnDate) {
        this.state.returnDate = getLocalDateString(7);
      }

      this.restoreState();
      this.bindDOM();
      this.setupAutocomplete();
      this.updateDateConstraints();
      this.updateUI();
      this.syncFromDOM();
      this.validate();

      // Bridge with existing app singleton if present
      if (typeof window !== 'undefined') {
        if (window.app) {
          this.bridgeWithApp(window.app);
        } else {
          window.addEventListener('load', () => {
            if (window.app) this.bridgeWithApp(window.app);
          });
        }
      }

      // Listen to popstate / pageshow to restore state on Back button navigation
      window.addEventListener('pageshow', () => {
        this.restoreState();
        this.updateUI();
        this.validate();
      });
    },

    // -----------------------------------------------------------
    // SYNC FROM DOM ELEMENTS
    // -----------------------------------------------------------
    syncFromDOM() {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      const depDateInput = document.getElementById('homeDepDate');
      const retDateInput = document.getElementById('homeReturnDate');

      if (origInput && origInput.value) {
        this.state.origin.raw = origInput.value;
        this.state.origin.code = parseAirportCode(origInput.value);
        this.state.origin.city = parseCityName(origInput.value);
      }
      if (destInput && destInput.value) {
        this.state.destination.raw = destInput.value;
        this.state.destination.code = parseAirportCode(destInput.value);
        this.state.destination.city = parseCityName(destInput.value);
      }
      if (depDateInput && depDateInput.value) {
        this.state.depDate = depDateInput.value;
      }
      if (retDateInput && retDateInput.value) {
        this.state.returnDate = retDateInput.value;
      }
    },

    // -----------------------------------------------------------
    // BRIDGE WITH APP SINGLETON
    // -----------------------------------------------------------
    bridgeWithApp(appInstance) {
      if (!appInstance) return;

      // Sync passengers state
      if (appInstance.state && appInstance.state.passengers) {
        this.state.passengers.adults = appInstance.state.passengers.adults;
        this.state.passengers.children = appInstance.state.passengers.children;
        this.state.passengers.infants = appInstance.state.passengers.infants;
      }
      if (appInstance.state && appInstance.state.cabinClass) {
        this.state.cabinClass = appInstance.state.cabinClass;
      }

      // Hook passenger changer
      const origChangePax = appInstance.changePassengerCount ? appInstance.changePassengerCount.bind(appInstance) : null;
      if (origChangePax && !appInstance._flySearchWidgetHooked) {
        appInstance._flySearchWidgetHooked = true;

        appInstance.changePassengerCount = (type, delta) => {
          origChangePax(type, delta);
          if (appInstance.state && appInstance.state.passengers) {
            this.state.passengers.adults = appInstance.state.passengers.adults;
            this.state.passengers.children = appInstance.state.passengers.children;
            this.state.passengers.infants = appInstance.state.passengers.infants;
          }
          this.saveState();
          this.validate();
        };

        const origTripType = appInstance.setTripType ? appInstance.setTripType.bind(appInstance) : null;
        if (origTripType) {
          appInstance.setTripType = (type) => {
            origTripType(type);
            this.state.tripType = type;
            this.saveState();
            this.validate();
          };
        }

        const origSwap = appInstance.swapHomeAirports ? appInstance.swapHomeAirports.bind(appInstance) : null;
        if (origSwap) {
          appInstance.swapHomeAirports = () => {
            origSwap();
            this.syncFromDOM();
            this.saveState();
            this.validate();
          };
        }

        const origQuickFilter = appInstance.quickFilterSearch ? appInstance.quickFilterSearch.bind(appInstance) : null;
        if (origQuickFilter) {
          appInstance.quickFilterSearch = (orig, dest) => {
            origQuickFilter(orig, dest);
            this.syncFromDOM();
            this.saveState();
            this.validate();
          };
        }

        const origSelectPop = appInstance.selectPopularDestination ? appInstance.selectPopularDestination.bind(appInstance) : null;
        if (origSelectPop) {
          appInstance.selectPopularDestination = (fromCity, toCity, toCode) => {
            origSelectPop(fromCity, toCity, toCode);
            this.syncFromDOM();
            this.saveState();
            this.validate();
          };
        }
      }
    },

    // -----------------------------------------------------------
    // STATE PERSISTENCE (sessionStorage)
    // -----------------------------------------------------------
    saveState() {
      try {
        sessionStorage.setItem(this.config.storageKey, JSON.stringify(this.state));
      } catch (err) {
        // Safe fallback if storage disabled
      }
    },

    restoreState() {
      try {
        const saved = sessionStorage.getItem(this.config.storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          this.state = Object.assign(this.state, parsed);
        }
      } catch (err) { }
    },

    // -----------------------------------------------------------
    // DOM BINDING
    // -----------------------------------------------------------
    bindDOM() {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      const depDateInput = document.getElementById('homeDepDate');
      const retDateInput = document.getElementById('homeReturnDate');
      const swapBtn = document.getElementById('btnSwapHome');
      const searchBtn = document.getElementById('btnHomeSearch');
      const multiSearchBtn = document.getElementById('btnMultiCitySearch');
      const tabRound = document.getElementById('tabRoundTrip');
      const tabOneWay = document.getElementById('tabOneWay');
      const tabMulti = document.getElementById('tabMultiCity');

      if (tabRound && typeof tabRound.addEventListener === 'function') tabRound.addEventListener('click', () => this.setTripType('roundtrip'));
      if (tabOneWay && typeof tabOneWay.addEventListener === 'function') tabOneWay.addEventListener('click', () => this.setTripType('oneway'));
      if (tabMulti && typeof tabMulti.addEventListener === 'function') tabMulti.addEventListener('click', () => this.setTripType('multicity'));

      if (origInput) {
        if (!origInput.value && this.state.origin.raw) {
          origInput.value = this.state.origin.raw;
        }
        const onOrigChange = () => {
          this.state.origin.raw = origInput.value;
          this.state.origin.code = parseAirportCode(origInput.value);
          this.state.origin.city = parseCityName(origInput.value);
          this.saveState();
          this.validate();
        };
        origInput.addEventListener('input', onOrigChange);
        origInput.addEventListener('change', onOrigChange);
      }

      if (destInput) {
        if (!destInput.value && this.state.destination.raw) {
          destInput.value = this.state.destination.raw;
        }
        const onDestChange = () => {
          this.state.destination.raw = destInput.value;
          this.state.destination.code = parseAirportCode(destInput.value);
          this.state.destination.city = parseCityName(destInput.value);
          this.saveState();
          this.validate();
        };
        destInput.addEventListener('input', onDestChange);
        destInput.addEventListener('change', onDestChange);
      }

      if (depDateInput) {
        if (!depDateInput.value && this.state.depDate) {
          depDateInput.value = this.state.depDate;
        }
        const onDepChange = () => {
          this.state.depDate = depDateInput.value;
          this.updateDateConstraints();
          this.saveState();
          this.validate();
        };
        depDateInput.addEventListener('change', onDepChange);
        depDateInput.addEventListener('input', onDepChange);
      }

      if (retDateInput) {
        if (!retDateInput.value && this.state.returnDate) {
          retDateInput.value = this.state.returnDate;
        }
        const onRetChange = () => {
          this.state.returnDate = retDateInput.value;
          this.saveState();
          this.validate();
        };
        retDateInput.addEventListener('change', onRetChange);
        retDateInput.addEventListener('input', onRetChange);
      }

      if (swapBtn) {
        swapBtn.onclick = (e) => {
          e.preventDefault();
          this.swapAirports();
        };
      }

      if (searchBtn) {
        searchBtn.onclick = (e) => {
          e.preventDefault();
          this.handleSubmit(e);
        };
      }

      if (multiSearchBtn) {
        multiSearchBtn.onclick = (e) => {
          e.preventDefault();
          this.handleSubmit(e);
        };
      }
    },

    // -----------------------------------------------------------
    // DATE CONSTRAINTS
    // -----------------------------------------------------------
    updateDateConstraints() {
      const todayStr = getLocalDateString(0);
      const depDateInput = document.getElementById('homeDepDate');
      const retDateInput = document.getElementById('homeReturnDate');

      if (depDateInput) {
        depDateInput.min = todayStr;
      }

      if (retDateInput) {
        const minReturn = (depDateInput && depDateInput.value) ? depDateInput.value : todayStr;
        retDateInput.min = minReturn;

        if (retDateInput.value && retDateInput.value < minReturn) {
          retDateInput.value = minReturn;
          this.state.returnDate = minReturn;
        }
      }
    },

    // -----------------------------------------------------------
    // TRIP TYPE SWITCHING
    // -----------------------------------------------------------
    setTripType(type) {
      if (!['roundtrip', 'oneway', 'multicity'].includes(type)) return;
      this.state.tripType = type;

      const tabRound = document.getElementById('tabRoundTrip');
      const tabOneWay = document.getElementById('tabOneWay');
      const tabMulti = document.getElementById('tabMultiCity');
      const stdForm = document.getElementById('standardSearchForm');
      const multiForm = document.getElementById('multiCityContainer');
      const retField = document.getElementById('returnDateField');

      [tabRound, tabOneWay, tabMulti].forEach(t => t && t.classList.remove('active'));

      if (type === 'roundtrip') {
        if (tabRound) tabRound.classList.add('active');
        if (stdForm) {
          stdForm.style.display = 'grid';
          stdForm.classList.add('is-roundtrip');
        }
        if (retField) retField.style.display = 'flex';
        if (multiForm) multiForm.style.display = 'none';
      } else if (type === 'oneway') {
        if (tabOneWay) tabOneWay.classList.add('active');
        if (stdForm) {
          stdForm.style.display = 'grid';
          stdForm.classList.remove('is-roundtrip');
        }
        if (retField) retField.style.display = 'none';
        if (multiForm) multiForm.style.display = 'none';
      } else if (type === 'multicity') {
        if (tabMulti) tabMulti.classList.add('active');
        if (stdForm) stdForm.style.display = 'none';
        if (multiForm) {
          multiForm.style.display = 'flex';
          this.renderMultiCityLegs();
        }
      }

      this.saveState();
      this.validate();
    },

    // -----------------------------------------------------------
    // SWAP ORIGIN AND DESTINATION
    // -----------------------------------------------------------
    swapAirports() {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      if (!origInput || !destInput) return;

      const tempVal = origInput.value;
      origInput.value = destInput.value;
      destInput.value = tempVal;

      const tempState = Object.assign({}, this.state.origin);
      this.state.origin = Object.assign({}, this.state.destination);
      this.state.destination = tempState;

      this.saveState();
      this.validate();

      // Trigger swap button rotate visual feedback
      const swapBtn = document.getElementById('btnSwapHome');
      if (swapBtn) {
        swapBtn.classList.add('is-rotating');
        setTimeout(() => swapBtn.classList.remove('is-rotating'), 300);
      }
    },

    // -----------------------------------------------------------
    // AUTOCOMPLETE IMPLEMENTATION
    // -----------------------------------------------------------
    setupAutocomplete() {
      this.bindAirportInput('homeOriginInput', 'homeOriginDropdown', (selected) => {
        this.state.origin = {
          city: selected.city,
          code: selected.IATA || selected.ICAO,
          raw: `${selected.city} (${selected.IATA || selected.ICAO})`
        };
        const input = document.getElementById('homeOriginInput');
        if (input) input.value = this.state.origin.raw;
        this.saveState();
        this.validate();
      });

      this.bindAirportInput('homeDestInput', 'homeDestDropdown', (selected) => {
        this.state.destination = {
          city: selected.city,
          code: selected.IATA || selected.ICAO,
          raw: `${selected.city} (${selected.IATA || selected.ICAO})`
        };
        const input = document.getElementById('homeDestInput');
        if (input) input.value = this.state.destination.raw;
        this.saveState();
        this.validate();
      });
    },

    bindAirportInput(inputId, dropdownId, onSelectCallback) {
      const input = document.getElementById(inputId);
      const dropdown = document.getElementById(dropdownId);
      if (!input || !dropdown) return;

      let debounceTimer = null;

      const renderMatches = (matches) => {
        if (!matches || matches.length === 0) {
          dropdown.innerHTML = '<div class="airport-dropdown-empty" style="padding: 12px; font-size: 0.85rem; color: var(--text-muted); text-align: center;">No matching airports found</div>';
          dropdown.classList.add('show');
          return;
        }

        dropdown.innerHTML = matches.map(a => `
          <div class="airport-dropdown-item" role="option" tabindex="0" data-iata="${a.IATA || a.ICAO}" data-city="${a.city}">
            <div>
              <div class="airport-item-main">${a.city} (${a.IATA || a.ICAO})</div>
              <div class="airport-item-sub">${a.name}, ${a.country}</div>
            </div>
            <span class="airport-item-iata">${a.IATA || a.ICAO}</span>
          </div>
        `).join('');

        dropdown.classList.add('show');

        // Bind clicks to items
        const items = dropdown.querySelectorAll('.airport-dropdown-item');
        items.forEach((item, index) => {
          const match = matches[index];
          item.addEventListener('click', () => {
            onSelectCallback(match);
            dropdown.classList.remove('show');
          });
          item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectCallback(match);
              dropdown.classList.remove('show');
              input.focus();
            }
          });
        });
      };

      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = (input.value || '').trim().toLowerCase();

        if (query.length < 1) {
          dropdown.classList.remove('show');
          return;
        }

        debounceTimer = setTimeout(async () => {
          // 1. Try local catalog first
          const localMatches = LOCAL_AIRPORT_CATALOG.filter(a =>
            a.city.toLowerCase().includes(query) ||
            (a.IATA && a.IATA.toLowerCase().includes(query)) ||
            a.name.toLowerCase().includes(query) ||
            a.country.toLowerCase().includes(query)
          ).slice(0, 6);

          renderMatches(localMatches);

          // 2. Query server SQLite asynchronously
          try {
            const res = await fetch(`/api/airports/search?q=${encodeURIComponent(query)}`);
            if (res.ok) {
              const serverMatches = await res.json();
              if (Array.isArray(serverMatches) && serverMatches.length > 0) {
                renderMatches(serverMatches.slice(0, 6));
              }
            }
          } catch (_) { }
        }, 120);
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.remove('show');
        }
      });
    },

    // -----------------------------------------------------------
    // PASSENGER COUNT & CABIN CONTROLS
    // -----------------------------------------------------------
    changePassengerCount(type, delta) {
      const p = this.state.passengers;
      const cfg = this.config;
      const current = p[type] || 0;
      const nextVal = current + delta;

      if (type === 'adults') {
        if (nextVal < cfg.minAdults || nextVal > cfg.maxAdults) return;
        p.adults = nextVal;
      } else if (type === 'children') {
        if (nextVal < 0 || nextVal > cfg.maxChildren) return;
        p.children = nextVal;
      } else if (type === 'infants') {
        if (nextVal < 0 || nextVal > cfg.maxInfants) return;
        // Check configurable infant-to-adult ratio
        if (nextVal > p.adults * cfg.maxInfantsPerAdult) {
          this.setFieldMessage('passengersError', `IATA Rule: Maximum ${cfg.maxInfantsPerAdult} infant per accompanying adult.`);
          return;
        }
        p.infants = nextVal;
      }

      // Check total passenger limit
      const total = p.adults + p.children + p.infants;
      if (total > cfg.maxTotalPassengers) {
        this.setFieldMessage('passengersError', `Maximum ${cfg.maxTotalPassengers} total passengers permitted per booking.`);
        return;
      }

      this.updatePassengerUI();
      this.saveState();
      this.validate();
    },

    selectCabinClass(cabin) {
      if (!this.config.cabinClasses.includes(cabin)) return;
      this.state.cabinClass = cabin;

      const pills = document.querySelectorAll('.cabin-pill');
      pills.forEach(pill => {
        if (pill.getAttribute('data-cabin') === cabin) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });

      this.updatePassengerUI();
      this.saveState();
      this.validate();
    },

    updatePassengerUI() {
      const p = this.state.passengers;
      const total = p.adults + p.children + p.infants;
      const cabin = this.state.cabinClass;

      const summaryText = document.getElementById('travelerSummaryText');
      const subtext = document.getElementById('travelerSubtext');
      const valAdults = document.getElementById('valAdults');
      const valChildren = document.getElementById('valChildren');
      const valInfants = document.getElementById('valInfants');
      const popoverTotal = document.getElementById('popoverTotalIndicator');

      if (summaryText) {
        summaryText.textContent = `${total} Traveler${total > 1 ? 's' : ''}, ${cabin}`;
      }
      if (subtext) {
        const parts = [];
        if (p.adults > 0) parts.push(`${p.adults} Adult${p.adults > 1 ? 's' : ''}`);
        if (p.children > 0) parts.push(`${p.children} Child${p.children > 1 ? 'ren' : ''}`);
        if (p.infants > 0) parts.push(`${p.infants} Infant${p.infants > 1 ? 's' : ''}`);
        subtext.textContent = `${parts.join(', ')} • ${cabin}`;
      }

      if (valAdults) valAdults.textContent = p.adults;
      if (valChildren) valChildren.textContent = p.children;
      if (valInfants) valInfants.textContent = p.infants;
      if (popoverTotal) popoverTotal.textContent = `Total: ${total}`;
    },

    // -----------------------------------------------------------
    // MULTI-CITY LEGS CONTROLLER
    // -----------------------------------------------------------
    addMultiCityLeg() {
      const legs = this.state.multiCityLegs;
      const cfg = this.config;
      if (legs.length >= cfg.maxMultiCityLegs) {
        this.setFieldMessage('searchValidationAlert', `Maximum ${cfg.maxMultiCityLegs} flight legs allowed for multi-city search.`);
        return;
      }

      const prevLeg = legs[legs.length - 1];
      const newLeg = {
        from: prevLeg ? prevLeg.to : 'Dhaka (DAC)',
        fromCity: prevLeg ? prevLeg.toCity : 'Dhaka',
        fromCode: prevLeg ? prevLeg.toCode : 'DAC',
        to: '',
        toCity: '',
        toCode: '',
        date: prevLeg && prevLeg.date ? prevLeg.date : getLocalDateString(legs.length * 3)
      };

      legs.push(newLeg);
      this.renderMultiCityLegs();
      this.saveState();
      this.validate();
    },

    removeMultiCityLeg(index) {
      const legs = this.state.multiCityLegs;
      if (legs.length <= this.config.minMultiCityLegs) {
        this.setFieldMessage('searchValidationAlert', `Multi-city itinerary requires at least ${this.config.minMultiCityLegs} flight legs.`);
        return;
      }
      legs.splice(index, 1);
      this.renderMultiCityLegs();
      this.saveState();
      this.validate();
    },

    renderMultiCityLegs() {
      const container = document.getElementById('multiCityLegsList');
      if (!container) return;

      const legs = this.state.multiCityLegs;
      const todayStr = getLocalDateString(0);

      container.innerHTML = legs.map((leg, idx) => `
        <div class="multicity-leg-row" data-leg-index="${idx}">
          <span class="multicity-leg-badge">Flight ${idx + 1}</span>

          <!-- Origin -->
          <div class="form-group-airport">
            <label class="input-label">FROM</label>
            <div class="input-airport-wrapper">
              <span class="airport-icon">🛫</span>
              <input type="text" id="mcOriginInput_${idx}" class="airport-input" placeholder="Departure City..." value="${leg.from || ''}" autocomplete="off">
            </div>
            <div class="airport-dropdown-list" id="mcOriginDropdown_${idx}"></div>
          </div>

          <!-- Swap -->
          <button type="button" class="btn-swap" onclick="FlightSearchWidget.swapMultiCityLeg(${idx})" title="Swap Airports" aria-label="Swap departure and destination for flight ${idx + 1}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
          </button>

          <!-- Destination -->
          <div class="form-group-airport">
            <label class="input-label">TO</label>
            <div class="input-airport-wrapper">
              <span class="airport-icon">🛬</span>
              <input type="text" id="mcDestInput_${idx}" class="airport-input" placeholder="Destination City..." value="${leg.to || ''}" autocomplete="off">
            </div>
            <div class="airport-dropdown-list" id="mcDestDropdown_${idx}"></div>
          </div>

          <!-- Date -->
          <div class="form-group-field">
            <label class="input-label">DEPARTURE</label>
            <div class="input-field-wrapper">
              <input type="date" id="mcDateInput_${idx}" class="date-input" min="${todayStr}" value="${leg.date || ''}" aria-label="Departure date for flight ${idx + 1}">
            </div>
          </div>

          <!-- Remove Leg Button -->
          ${legs.length > this.config.minMultiCityLegs ? `
            <button type="button" class="btn-remove-leg" onclick="FlightSearchWidget.removeMultiCityLeg(${idx})" title="Remove Flight ${idx + 1}" aria-label="Remove flight ${idx + 1}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          ` : `
            <div style="width: 44px;"></div>
          `}
        </div>
      `).join('');

      // Bind autocomplete to each multi-city input
      legs.forEach((leg, idx) => {
        this.bindAirportInput(`mcOriginInput_${idx}`, `mcOriginDropdown_${idx}`, (sel) => {
          leg.from = `${sel.city} (${sel.IATA || sel.ICAO})`;
          leg.fromCity = sel.city;
          leg.fromCode = sel.IATA || sel.ICAO;
          const inp = document.getElementById(`mcOriginInput_${idx}`);
          if (inp) inp.value = leg.from;
          this.saveState();
          this.validate();
        });

        this.bindAirportInput(`mcDestInput_${idx}`, `mcDestDropdown_${idx}`, (sel) => {
          leg.to = `${sel.city} (${sel.IATA || sel.ICAO})`;
          leg.toCity = sel.city;
          leg.toCode = sel.IATA || sel.ICAO;
          const inp = document.getElementById(`mcDestInput_${idx}`);
          if (inp) inp.value = leg.to;
          this.saveState();
          this.validate();
        });

        const dateInput = document.getElementById(`mcDateInput_${idx}`);
        if (dateInput) {
          dateInput.addEventListener('change', () => {
            leg.date = dateInput.value;
            this.saveState();
            this.validate();
          });
        }
      });
    },

    swapMultiCityLeg(index) {
      const leg = this.state.multiCityLegs[index];
      if (!leg) return;
      const tmpFrom = leg.from;
      const tmpCity = leg.fromCity;
      const tmpCode = leg.fromCode;

      leg.from = leg.to;
      leg.fromCity = leg.toCity;
      leg.fromCode = leg.toCode;

      leg.to = tmpFrom;
      leg.toCity = tmpCity;
      leg.toCode = tmpCode;

      this.renderMultiCityLegs();
      this.saveState();
      this.validate();
    },

    // -----------------------------------------------------------
    // VALIDATION ENGINE
    // -----------------------------------------------------------
    validate() {
      const state = this.state;
      const cfg = this.config;
      const todayStr = getLocalDateString(0);
      const errors = {};
      let summaryError = null;

      // 1. Passenger Count Validation (Configurable Rules)
      const p = state.passengers;
      if (!p.adults || p.adults < cfg.minAdults) {
        errors.passengers = `At least ${cfg.minAdults} adult passenger is required.`;
      } else if (p.adults > cfg.maxAdults) {
        errors.passengers = `Maximum ${cfg.maxAdults} adults allowed per booking.`;
      } else if (p.infants > p.adults * cfg.maxInfantsPerAdult) {
        errors.passengers = `Infant limit exceeded: Maximum ${cfg.maxInfantsPerAdult} infant per accompanying adult (IATA regulation).`;
      }

      const totalPax = (p.adults || 0) + (p.children || 0) + (p.infants || 0);
      if (!errors.passengers && totalPax > cfg.maxTotalPassengers) {
        errors.passengers = `Maximum ${cfg.maxTotalPassengers} passengers permitted per search.`;
      }

      // 2. Standard Route Validation (One Way & Round Trip)
      if (state.tripType === 'roundtrip' || state.tripType === 'oneway') {
        const origInput = document.getElementById('homeOriginInput');
        const destInput = document.getElementById('homeDestInput');
        const depInput = document.getElementById('homeDepDate');
        const retInput = document.getElementById('homeReturnDate');

        const fromVal = (origInput && typeof origInput.value === 'string' && origInput.value.trim()) ? origInput.value.trim() : (state.origin.raw || '');
        const toVal = (destInput && typeof destInput.value === 'string' && destInput.value.trim()) ? destInput.value.trim() : (state.destination.raw || '');
        const depDate = (depInput && depInput.value) ? depInput.value : (state.depDate || '');
        const retDate = (retInput && retInput.value) ? retInput.value : (state.returnDate || '');

        const fromCode = parseAirportCode(fromVal);
        const toCode = parseAirportCode(toVal);
        const fromCity = parseCityName(fromVal);
        const toCity = parseCityName(toVal);

        if (!fromVal) {
          errors.origin = 'Departure airport or city is required.';
        }

        if (!toVal) {
          errors.destination = 'Destination airport or city is required.';
        } else if (fromVal && (
          (fromCode && toCode && fromCode === toCode) ||
          (fromCity && toCity && fromCity.toLowerCase() === toCity.toLowerCase())
        )) {
          errors.destination = 'Origin and destination cannot be identical.';
        }

        if (!depDate) {
          errors.depDate = 'Departure date is required.';
        } else if (depDate < todayStr) {
          errors.depDate = 'Departure date cannot be in the past.';
        }

        if (state.tripType === 'roundtrip') {
          if (!retDate) {
            errors.returnDate = 'Return date is required for round trips.';
          } else if (retDate < depDate) {
            errors.returnDate = 'Return date cannot precede departure date.';
          }
        }
      }

      // 3. Multi-City Validation
      if (state.tripType === 'multicity') {
        const legs = state.multiCityLegs;
        if (legs.length < cfg.minMultiCityLegs) {
          errors.multiCity = `At least ${cfg.minMultiCityLegs} flight legs required.`;
        }

        for (let i = 0; i < legs.length; i++) {
          const l = legs[i];
          const lFromCode = parseAirportCode(l.from);
          const lToCode = parseAirportCode(l.to);
          const lFromCity = parseCityName(l.from);
          const lToCity = parseCityName(l.to);

          if (!l.from) {
            errors[`mcLeg_${i}`] = `Flight ${i + 1}: Origin is required.`;
            break;
          }
          if (!l.to) {
            errors[`mcLeg_${i}`] = `Flight ${i + 1}: Destination is required.`;
            break;
          }
          if ((lFromCode && lToCode && lFromCode === lToCode) || (lFromCity && lToCity && lFromCity.toLowerCase() === lToCity.toLowerCase())) {
            errors[`mcLeg_${i}`] = `Flight ${i + 1}: Origin and destination cannot be identical.`;
            break;
          }
          if (!l.date) {
            errors[`mcLeg_${i}`] = `Flight ${i + 1}: Date is required.`;
            break;
          }
          if (l.date < todayStr) {
            errors[`mcLeg_${i}`] = `Flight ${i + 1}: Date cannot be in the past.`;
            break;
          }
          if (i > 0 && legs[i - 1].date && l.date < legs[i - 1].date) {
            errors[`mcLeg_${i}`] = `Flight ${i + 1}: Date cannot be earlier than Flight ${i}.`;
            break;
          }
        }
      }

      const isValid = Object.keys(errors).length === 0;
      if (!isValid) {
        summaryError = Object.values(errors)[0];
      }

      this.renderValidationFeedback(errors, summaryError, isValid);

      return { isValid, errors, summaryError };
    },

    // -----------------------------------------------------------
    // INLINE VALIDATION FEEDBACK RENDERING
    // -----------------------------------------------------------
    renderValidationFeedback(errors, summaryError, isValid) {
      // 1. Toggle Search Buttons Disabled State
      const btnHome = document.getElementById('btnHomeSearch');
      const btnMulti = document.getElementById('btnMultiCitySearch');

      [btnHome, btnMulti].forEach(btn => {
        if (btn) {
          btn.disabled = !isValid;
          btn.setAttribute('aria-disabled', String(!isValid));
        }
      });

      // 2. Field-level error messages
      this.setFieldMessage('originError', errors.origin, 'originGroup');
      this.setFieldMessage('destError', errors.destination, 'destGroup');
      this.setFieldMessage('depDateError', errors.depDate, 'departureDateField');
      this.setFieldMessage('returnDateError', errors.returnDate, 'returnDateField');
      this.setFieldMessage('passengersError', errors.passengers, 'passengerClassTrigger');

      // 3. Multi-city alert
      const alertBox = document.getElementById('searchValidationAlert');
      if (alertBox) {
        if (!isValid && summaryError) {
          alertBox.textContent = `⚠️ ${summaryError}`;
          alertBox.style.display = 'block';
        } else {
          alertBox.textContent = '';
          alertBox.style.display = 'none';
        }
      }
    },

    setFieldMessage(elemId, message, groupId = null) {
      const el = document.getElementById(elemId);
      if (el) {
        if (message) {
          el.textContent = message;
          el.style.display = 'block';
          el.setAttribute('role', 'alert');
        } else {
          el.textContent = '';
          el.style.display = 'none';
        }
      }

      if (groupId) {
        const grp = document.getElementById(groupId);
        if (grp) {
          if (message) {
            grp.classList.add('has-error');
            const inp = grp.querySelector('input');
            if (inp) inp.setAttribute('aria-invalid', 'true');
          } else {
            grp.classList.remove('has-error');
            const inp = grp.querySelector('input');
            if (inp) inp.setAttribute('aria-invalid', 'false');
          }
        }
      }
    },

    // -----------------------------------------------------------
    // SEARCH SUBMISSION & QUERY STATE ENCODING
    // -----------------------------------------------------------
    handleSubmit(e) {
      if (e && e.preventDefault) e.preventDefault();

      if (this.state.isSubmitting) return;

      const { isValid, summaryError } = this.validate();
      if (!isValid) {
        if (summaryError && typeof window.app !== 'undefined' && window.app.showToast) {
          window.app.showToast(summaryError, 'warning');
        }
        return { success: false, summaryError };
      }

      // Prevent double submission
      this.state.isSubmitting = true;
      const btn = document.getElementById(this.state.tripType === 'multicity' ? 'btnMultiCitySearch' : 'btnHomeSearch');
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = `
          <div class="loading-spinner" style="width: 18px; height: 18px; border-width: 2px; border-color: rgba(255,255,255,0.4); border-top-color: #fff;"></div>
          <span>Searching Flights...</span>
        `;
      }

      this.saveState();

      // Encode query string safely
      const params = new URLSearchParams();
      const s = this.state;

      params.set('trip_type', s.tripType);
      params.set('adults', s.passengers.adults);
      params.set('children', s.passengers.children);
      params.set('infants', s.passengers.infants);
      params.set('cabin', s.cabinClass);

      if (s.tripType === 'multicity') {
        s.multiCityLegs.forEach((leg, idx) => {
          params.set(`from${idx + 1}`, leg.fromCode || leg.fromCity);
          params.set(`to${idx + 1}`, leg.toCode || leg.toCity);
          params.set(`departure${idx + 1}`, leg.date);
        });
      } else {
        const origCode = s.origin.code || parseAirportCode(s.origin.raw) || s.origin.city;
        const destCode = s.destination.code || parseAirportCode(s.destination.raw) || s.destination.city;

        params.set('from', origCode);
        params.set('fromCity', s.origin.city || parseCityName(s.origin.raw));
        params.set('to', destCode);
        params.set('toCity', s.destination.city || parseCityName(s.destination.raw));
        params.set('departure', s.depDate);

        if (s.tripType === 'roundtrip') {
          params.set('return', s.returnDate);
        }
      }

      const targetUrl = `/flights/search?${params.toString()}`;

      // Mock frontend service dispatch & navigation
      if (typeof window !== 'undefined' && window.location) {
        setTimeout(() => {
          try {
            window.location.href = targetUrl;
          } catch (_) { }
        }, 150);
      }

      return { success: true, url: targetUrl };
    },

    // -----------------------------------------------------------
    // GENERAL UI REFRESH
    // -----------------------------------------------------------
    updateUI() {
      this.setTripType(this.state.tripType);

      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      const depDateInput = document.getElementById('homeDepDate');
      const retDateInput = document.getElementById('homeReturnDate');

      if (origInput && this.state.origin.raw) origInput.value = this.state.origin.raw;
      if (destInput && this.state.destination.raw) destInput.value = this.state.destination.raw;
      if (depDateInput && this.state.depDate) depDateInput.value = this.state.depDate;
      if (retDateInput && this.state.returnDate) retDateInput.value = this.state.returnDate;

      this.updatePassengerUI();
      this.selectCabinClass(this.state.cabinClass);
    }
  };

  // Auto-initialize on load if document is present
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => FlightSearchWidget.init());
    } else {
      setTimeout(() => FlightSearchWidget.init(), 0);
    }
  }

  return FlightSearchWidget;
}));
