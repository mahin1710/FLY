/**
 * FLY AVIATION - UNIFIED TRAVEL SEARCH WIDGET (FLIGHTS, HOTELS & CAR RENTALS)
 * Fixes:
 * - Asia/Dhaka timezone-aware past-date prevention
 * - Exact Trip Type order: One Way (default) -> Round Trip -> Multi City
 * - Airport autocomplete with mousedown/keyboard navigation & loading indicator
 * - Never leaves Search Flights frozen or disabled; verifies /api/flights before navigating
 * - Removes Travellers selector from homepage (handled in booking flow)
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

  const SEARCH_CONFIG = {
    bookingTimeZone: 'Asia/Dhaka',
    minMultiCityLegs: 2,
    maxMultiCityLegs: 5,
    storageKey: 'fly_search_state_v2'
  };

  const LOCAL_AIRPORT_CATALOG = [
    { id: 185, city: 'Dhaka', IATA: 'DAC', ICAO: 'VGHS', name: 'Hazrat Shahjalal International Airport', country: 'Bangladesh' },
    { id: 186, city: "Cox's Bazar", IATA: 'CXB', ICAO: 'VGCB', name: "Cox's Bazar Airport", country: 'Bangladesh' },
    { id: 187, city: 'Chittagong', IATA: 'CGP', ICAO: 'VGEG', name: 'Shah Amanat International Airport', country: 'Bangladesh' },
    { id: 188, city: 'Sylhet', IATA: 'ZYL', ICAO: 'VGSY', name: 'Osmani International Airport', country: 'Bangladesh' },
    { id: 189, city: 'Jessore', IATA: 'JSR', ICAO: 'VGJR', name: 'Jashore Airport', country: 'Bangladesh' },
    { id: 190, city: 'Barisal', IATA: 'BZL', ICAO: 'VGBR', name: 'Barisal Airport', country: 'Bangladesh' },
    { id: 191, city: 'Saidpur', IATA: 'SPD', ICAO: 'VGSD', name: 'Saidpur Airport', country: 'Bangladesh' },
    { id: 192, city: 'Rajshahi', IATA: 'RJH', ICAO: 'VGRJ', name: 'Shah Makhdum Airport', country: 'Bangladesh' },
    { id: 201, city: 'Dubai', IATA: 'DXB', ICAO: 'OMDB', name: 'Dubai International Airport', country: 'United Arab Emirates' },
    { id: 202, city: 'Bangkok', IATA: 'BKK', ICAO: 'VTBS', name: 'Suvarnabhumi Airport', country: 'Thailand' },
    { id: 203, city: 'Singapore', IATA: 'SIN', ICAO: 'WSSS', name: 'Singapore Changi Airport', country: 'Singapore' },
    { id: 204, city: 'Kuala Lumpur', IATA: 'KUL', ICAO: 'WMKK', name: 'Kuala Lumpur International Airport', country: 'Malaysia' },
    { id: 205, city: 'London', IATA: 'LHR', ICAO: 'EGLL', name: 'London Heathrow Airport', country: 'United Kingdom' },
    { id: 206, city: 'Doha', IATA: 'DOH', ICAO: 'OTHH', name: 'Hamad International Airport', country: 'Qatar' },
    { id: 207, city: 'Istanbul', IATA: 'IST', ICAO: 'LTFM', name: 'Istanbul Airport', country: 'Turkey' },
    { id: 208, city: 'Jeddah', IATA: 'JED', ICAO: 'OEJN', name: 'King Abdulaziz International Airport', country: 'Saudi Arabia' }
  ];

  function getDhakaDateString(offsetDays = 0) {
    try {
      const now = new Date();
      // Format current date specifically in Asia/Dhaka regardless of client PC timezone
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: SEARCH_CONFIG.bookingTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(now);
      const y = Number(parts.find(p => p.type === 'year').value);
      const m = Number(parts.find(p => p.type === 'month').value) - 1;
      const d = Number(parts.find(p => p.type === 'day').value);
      const dt = new Date(Date.UTC(y, m, d + offsetDays));
      return dt.toISOString().slice(0, 10);
    } catch (_) {
      const d = new Date(Date.now() + offsetDays * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }

  function addDaysToIso(isoDate, deltaDays) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return getDhakaDateString(deltaDays);
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
  }

  function parseAirportCode(inputStr) {
    if (!inputStr) return '';
    const match = String(inputStr).match(/\(([A-Za-z]{3})\)/);
    if (match) return match[1].toUpperCase();
    const trimmed = String(inputStr).trim();
    if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
    const clean = trimmed.toLowerCase();
    const found = LOCAL_AIRPORT_CATALOG.find(a =>
      a.city.toLowerCase() === clean ||
      (a.IATA && a.IATA.toLowerCase() === clean) ||
      a.name.toLowerCase() === clean
    );
    return found ? (found.IATA || found.ICAO) : '';
  }

  function parseCityName(inputStr) {
    if (!inputStr) return '';
    const s = String(inputStr).trim();
    const clean = s.replace(/\([A-Za-z]{3}\)/g, '').replace(/-.+$/, '').trim();
    const code = parseAirportCode(s);
    if (code) {
      const found = LOCAL_AIRPORT_CATALOG.find(a => a.IATA === code);
      if (found) return found.city;
    }
    return clean || s;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const FlightSearchWidget = {
    config: SEARCH_CONFIG,
    catalog: LOCAL_AIRPORT_CATALOG,
    state: {
      activeProduct: 'flights', // flights | hotels | cars
      tripType: 'oneway',       // oneway (default) -> roundtrip -> multicity
      origin: { city: 'Dhaka', code: 'DAC', raw: 'Hazrat Shahjalal International Airport (DAC) - Dhaka' },
      destination: { city: "Cox's Bazar", code: 'CXB', raw: "Cox's Bazar Airport (CXB) - Cox's Bazar" },
      depDate: '',
      returnDate: '',
      multiCityLegs: [
        { from: 'Dhaka (DAC)', fromCity: 'Dhaka', fromCode: 'DAC', to: 'Chittagong (CGP)', toCity: 'Chittagong', toCode: 'CGP', date: '' },
        { from: 'Chittagong (CGP)', fromCity: 'Chittagong', fromCode: 'CGP', to: "Cox's Bazar (CXB)", toCity: "Cox's Bazar", toCode: 'CXB', date: '' }
      ],
      isSubmitting: false
    },

    init() {
      this.state.isSubmitting = false;
      this.restoreState();
      this.state.isSubmitting = false; // Never keep frozen submitting lock across reloads/back button

      if (!this.state.depDate || this.state.depDate < getDhakaDateString(0)) {
        this.state.depDate = getDhakaDateString(3);
      }
      if (!this.state.returnDate || this.state.returnDate < this.state.depDate) {
        this.state.returnDate = addDaysToIso(this.state.depDate, 4);
      }
      this.state.multiCityLegs.forEach((leg, i) => {
        if (!leg.date || leg.date < getDhakaDateString(0)) {
          leg.date = getDhakaDateString(2 + i * 2);
        }
      });

      this.bindDOM();
      this.setupAutocomplete();
      this.updateDateConstraints();
      this.updateUI();
      this.initHotelsAndCarsDefaults();

      window.addEventListener('pageshow', () => {
        this.state.isSubmitting = false;
        this.resetSearchButtons();
        this.updateDateConstraints();
      });
    },

    saveState() {
      try {
        const clone = Object.assign({}, this.state, { isSubmitting: false });
        sessionStorage.setItem(this.config.storageKey, JSON.stringify(clone));
      } catch (_) {}
    },

    restoreState() {
      try {
        const raw = sessionStorage.getItem(this.config.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            this.state = Object.assign(this.state, parsed, { isSubmitting: false });
          }
        }
      } catch (_) {}
    },

    showAlert(message) {
      const alertBox = document.getElementById('searchValidationAlert');
      if (!alertBox) return;
      if (message) {
        alertBox.textContent = message;
        alertBox.style.display = 'block';
      } else {
        alertBox.textContent = '';
        alertBox.style.display = 'none';
      }
    },

    setFieldMessage(elemId, message, groupId) {
      const el = document.getElementById(elemId);
      if (el) {
        el.textContent = message || '';
        el.style.display = message ? 'block' : 'none';
      }
      if (groupId) {
        const grp = document.getElementById(groupId);
        if (grp) {
          grp.classList.toggle('has-error', Boolean(message));
          const inp = grp.querySelector('input');
          if (inp) inp.setAttribute('aria-invalid', message ? 'true' : 'false');
        }
      }
    },

    clearAllValidation() {
      this.showAlert('');
      this.setFieldMessage('originError', '', 'originGroup');
      this.setFieldMessage('destError', '', 'destGroup');
      this.setFieldMessage('depDateError', '', 'departureDateField');
      this.setFieldMessage('returnDateError', '', 'returnDateField');
    },

    switchProductTab(product) {
      if (!['flights', 'hotels', 'cars'].includes(product)) return;
      this.state.activeProduct = product;
      this.clearAllValidation();

      const tabF = document.getElementById('catTabFlights');
      const tabH = document.getElementById('catTabHotels');
      const tabC = document.getElementById('catTabCarRental');
      [
        [tabF, product === 'flights'],
        [tabH, product === 'hotels'],
        [tabC, product === 'cars']
      ].forEach(([el, active]) => {
        if (el) {
          el.classList.toggle('active', active);
          el.setAttribute('aria-selected', String(active));
        }
      });

      const tripPills = document.getElementById('flightTripPills');
      const stdForm = document.getElementById('standardSearchForm');
      const multiForm = document.getElementById('multiCityContainer');
      const quickBar = document.getElementById('flightQuickRoutesBar');
      const hotelForm = document.getElementById('hotelsSearchForm');
      const carForm = document.getElementById('carsSearchForm');

      if (product === 'flights') {
        if (tripPills) tripPills.style.display = 'inline-flex';
        if (quickBar) quickBar.style.display = 'flex';
        if (hotelForm) hotelForm.style.display = 'none';
        if (carForm) carForm.style.display = 'none';
        this.setTripType(this.state.tripType);
      } else if (product === 'hotels') {
        if (tripPills) tripPills.style.display = 'none';
        if (stdForm) stdForm.style.display = 'none';
        if (multiForm) multiForm.style.display = 'none';
        if (quickBar) quickBar.style.display = 'none';
        if (hotelForm) hotelForm.style.display = 'grid';
        if (carForm) carForm.style.display = 'none';
      } else {
        if (tripPills) tripPills.style.display = 'none';
        if (stdForm) stdForm.style.display = 'none';
        if (multiForm) multiForm.style.display = 'none';
        if (quickBar) quickBar.style.display = 'none';
        if (hotelForm) hotelForm.style.display = 'none';
        if (carForm) carForm.style.display = 'grid';
      }
      this.saveState();
    },

    bindDOM() {
      const tabF = document.getElementById('catTabFlights');
      const tabH = document.getElementById('catTabHotels');
      const tabC = document.getElementById('catTabCarRental');
      if (tabF) tabF.addEventListener('click', () => this.switchProductTab('flights'));
      if (tabH) tabH.addEventListener('click', () => this.switchProductTab('hotels'));
      if (tabC) tabC.addEventListener('click', () => this.switchProductTab('cars'));

      const tabOneWay = document.getElementById('tabOneWay');
      const tabRound = document.getElementById('tabRoundTrip');
      const tabMulti = document.getElementById('tabMultiCity');
      if (tabOneWay) tabOneWay.addEventListener('click', () => this.setTripType('oneway'));
      if (tabRound) tabRound.addEventListener('click', () => this.setTripType('roundtrip'));
      if (tabMulti) tabMulti.addEventListener('click', () => this.setTripType('multicity'));

      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      const depDateInput = document.getElementById('homeDepDate');
      const retDateInput = document.getElementById('homeReturnDate');

      if (origInput) {
        origInput.addEventListener('input', () => {
          this.state.origin = {
            raw: origInput.value,
            code: parseAirportCode(origInput.value),
            city: parseCityName(origInput.value)
          };
          this.clearAllValidation();
          this.saveState();
        });
      }

      if (destInput) {
        destInput.addEventListener('input', () => {
          this.state.destination = {
            raw: destInput.value,
            code: parseAirportCode(destInput.value),
            city: parseCityName(destInput.value)
          };
          this.clearAllValidation();
          this.saveState();
        });
      }

      if (depDateInput) {
        const onDepChange = () => {
          const todayStr = getDhakaDateString(0);
          if (depDateInput.value && depDateInput.value < todayStr) {
            this.setFieldMessage('depDateError', `Past travel dates are blocked (earliest ${todayStr}).`, 'departureDateField');
            depDateInput.value = '';
            this.state.depDate = '';
          } else {
            this.state.depDate = depDateInput.value;
            this.setFieldMessage('depDateError', '', 'departureDateField');
          }
          this.updateDateConstraints();
          this.saveState();
        };
        depDateInput.addEventListener('change', onDepChange);
        depDateInput.addEventListener('input', onDepChange);
      }

      if (retDateInput) {
        const onRetChange = () => {
          const minRet = this.state.depDate || getDhakaDateString(0);
          if (retDateInput.value && retDateInput.value < minRet) {
            this.setFieldMessage('returnDateError', 'Return date cannot be before departure date.', 'returnDateField');
            retDateInput.value = '';
            this.state.returnDate = '';
          } else {
            this.state.returnDate = retDateInput.value;
            this.setFieldMessage('returnDateError', '', 'returnDateField');
          }
          this.saveState();
        };
        retDateInput.addEventListener('change', onRetChange);
        retDateInput.addEventListener('input', onRetChange);
      }

      const swapBtn = document.getElementById('btnSwapHome');
      if (swapBtn) swapBtn.addEventListener('click', (e) => { e.preventDefault(); this.swapAirports(); });

      const flightForm = document.getElementById('standardSearchForm');
      if (flightForm && flightForm.tagName === 'FORM') {
        flightForm.addEventListener('submit', (e) => this.handleSubmit(e));
      }
      const searchBtn = document.getElementById('btnHomeSearch');
      if (searchBtn) searchBtn.addEventListener('click', (e) => this.handleSubmit(e));

      const multiSearchBtn = document.getElementById('btnMultiCitySearch');
      if (multiSearchBtn) multiSearchBtn.addEventListener('click', (e) => this.handleSubmit(e));

      const addLegBtn = document.getElementById('btnAddCityLeg');
      if (addLegBtn) addLegBtn.addEventListener('click', () => this.addMultiCityLeg());
    },

    updateDateConstraints() {
      const todayStr = getDhakaDateString(0);
      const depInput = document.getElementById('homeDepDate');
      const retInput = document.getElementById('homeReturnDate');

      if (depInput) {
        depInput.min = todayStr;
        if (depInput.value && depInput.value < todayStr) {
          depInput.value = todayStr;
          this.state.depDate = todayStr;
        }
      }
      if (retInput) {
        const minRet = (depInput && depInput.value) ? depInput.value : todayStr;
        retInput.min = minRet;
        if (retInput.value && retInput.value < minRet) {
          retInput.value = '';
          this.state.returnDate = '';
        }
      }
    },

    setTripType(type) {
      if (!['oneway', 'roundtrip', 'multicity'].includes(type)) type = 'oneway';
      this.state.tripType = type;

      const tabOneWay = document.getElementById('tabOneWay');
      const tabRound = document.getElementById('tabRoundTrip');
      const tabMulti = document.getElementById('tabMultiCity');
      const stdForm = document.getElementById('standardSearchForm');
      const multiForm = document.getElementById('multiCityContainer');
      const retField = document.getElementById('returnDateField');

      [
        [tabOneWay, type === 'oneway'],
        [tabRound, type === 'roundtrip'],
        [tabMulti, type === 'multicity']
      ].forEach(([btn, active]) => {
        if (btn) {
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-checked', String(active));
        }
      });

      if (type === 'multicity') {
        if (stdForm) stdForm.style.display = 'none';
        if (multiForm) {
          multiForm.style.display = 'flex';
          this.renderMultiCityLegs();
        }
      } else {
        if (multiForm) multiForm.style.display = 'none';
        if (stdForm) {
          stdForm.style.display = 'grid';
          stdForm.classList.toggle('is-oneway', type === 'oneway');
          stdForm.classList.toggle('is-roundtrip', type === 'roundtrip');
        }
        if (retField) retField.style.display = type === 'roundtrip' ? 'flex' : 'none';
      }
      this.clearAllValidation();
      this.saveState();
    },

    swapAirports() {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      if (!origInput || !destInput) return;

      const tmpVal = origInput.value;
      origInput.value = destInput.value;
      destInput.value = tmpVal;

      const tmpState = Object.assign({}, this.state.origin);
      this.state.origin = Object.assign({}, this.state.destination);
      this.state.destination = tmpState;

      this.clearAllValidation();
      this.saveState();

      const swapBtn = document.getElementById('btnSwapHome');
      if (swapBtn) {
        swapBtn.classList.add('is-rotating');
        setTimeout(() => swapBtn.classList.remove('is-rotating'), 300);
      }
    },

    setupAutocomplete() {
      this.bindAirportInput('homeOriginInput', 'homeOriginDropdown', (selected) => {
        const code = selected.IATA || selected.ICAO || '';
        this.state.origin = {
          city: selected.city,
          code: code,
          raw: `${selected.name} (${code}) - ${selected.city}`
        };
        const input = document.getElementById('homeOriginInput');
        if (input) input.value = `${selected.city} (${code})`;
        this.state.origin.raw = input ? input.value : `${selected.city} (${code})`;
        this.clearAllValidation();
        this.saveState();
      });

      this.bindAirportInput('homeDestInput', 'homeDestDropdown', (selected) => {
        const code = selected.IATA || selected.ICAO || '';
        this.state.destination = {
          city: selected.city,
          code: code,
          raw: `${selected.city} (${code})`
        };
        const input = document.getElementById('homeDestInput');
        if (input) input.value = `${selected.city} (${code})`;
        this.clearAllValidation();
        this.saveState();
      });
    },

    bindAirportInput(inputId, dropdownId, onSelectCallback) {
      const input = document.getElementById(inputId);
      const dropdown = document.getElementById(dropdownId);
      if (!input || !dropdown) return;

      let debounceTimer = null;
      let currentMatches = [];
      let highlightIndex = -1;

      const updateHighlight = () => {
        const items = dropdown.querySelectorAll('.airport-dropdown-item');
        items.forEach((el, idx) => {
          const active = idx === highlightIndex;
          el.classList.toggle('is-highlighted', active);
          el.setAttribute('aria-selected', String(active));
          if (active && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
          }
        });
      };

      const renderLoading = () => {
        dropdown.innerHTML = '<div class="airport-dropdown-empty" style="padding:12px;font-size:0.85rem;color:var(--text-muted);text-align:center;">Searching airports...</div>';
        dropdown.classList.add('show');
      };

      const renderMatches = (matches) => {
        currentMatches = matches || [];
        highlightIndex = currentMatches.length > 0 ? 0 : -1;
        if (!currentMatches.length) {
          dropdown.innerHTML = '<div class="airport-dropdown-empty" style="padding:12px;font-size:0.85rem;color:var(--text-muted);text-align:center;">No matching airports found</div>';
          dropdown.classList.add('show');
          return;
        }

        dropdown.innerHTML = currentMatches.map((a, idx) => {
          const code = esc(a.IATA || a.ICAO || '');
          return `
            <div class="airport-dropdown-item ${idx === 0 ? 'is-highlighted' : ''}" role="option" aria-selected="${idx === 0 ? 'true' : 'false'}" data-idx="${idx}">
              <div>
                <div class="airport-item-main">${esc(a.name)}</div>
                <div class="airport-item-sub">${esc(a.city)}, ${esc(a.country)} (${code})</div>
              </div>
              <span class="airport-item-iata">${code}</span>
            </div>`;
        }).join('');
        dropdown.classList.add('show');

        dropdown.querySelectorAll('.airport-dropdown-item').forEach((item) => {
          const idx = Number(item.getAttribute('data-idx'));
          const match = currentMatches[idx];
          // mousedown fires BEFORE input blur so selection never gets dropped
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onSelectCallback(match);
            dropdown.classList.remove('show');
          });
        });
      };

      const runSearch = async (queryRaw) => {
        const q = (queryRaw || '').trim().toLowerCase();
        if (!q) {
          renderMatches(LOCAL_AIRPORT_CATALOG.slice(0, 6));
          return;
        }
        renderLoading();

        const localMatches = LOCAL_AIRPORT_CATALOG.filter(a =>
          a.city.toLowerCase().includes(q) ||
          (a.IATA && a.IATA.toLowerCase().includes(q)) ||
          a.name.toLowerCase().includes(q) ||
          a.country.toLowerCase().includes(q)
        );

        try {
          const res = await fetch(`/api/airports/search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const serverMatches = await res.json();
            if (Array.isArray(serverMatches) && serverMatches.length > 0) {
              const seen = new Set();
              const combined = [];
              serverMatches.concat(localMatches).forEach(a => {
                const k = (a.IATA || a.name).toUpperCase();
                if (!seen.has(k)) {
                  seen.add(k);
                  combined.push(a);
                }
              });
              renderMatches(combined.slice(0, 8));
              return;
            }
          }
        } catch (_) {}

        renderMatches(localMatches.slice(0, 6));
      };

      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const val = input.value;
        if (!val.trim()) {
          dropdown.classList.remove('show');
          return;
        }
        debounceTimer = setTimeout(() => runSearch(val), 110);
      });

      input.addEventListener('keydown', (e) => {
        if (!dropdown.classList.contains('show')) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (currentMatches.length) {
            highlightIndex = (highlightIndex + 1) % currentMatches.length;
            updateHighlight();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (currentMatches.length) {
            highlightIndex = (highlightIndex - 1 + currentMatches.length) % currentMatches.length;
            updateHighlight();
          }
        } else if (e.key === 'Enter') {
          if (highlightIndex >= 0 && currentMatches[highlightIndex]) {
            e.preventDefault();
            onSelectCallback(currentMatches[highlightIndex]);
            dropdown.classList.remove('show');
          }
        } else if (e.key === 'Escape') {
          dropdown.classList.remove('show');
        }
      });

      document.addEventListener('mousedown', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.remove('show');
        }
      });
    },

    addMultiCityLeg() {
      const legs = this.state.multiCityLegs;
      if (legs.length >= this.config.maxMultiCityLegs) {
        this.showAlert(`Maximum ${this.config.maxMultiCityLegs} flight legs permitted for Multi-City search.`);
        return;
      }
      const prev = legs[legs.length - 1];
      legs.push({
        from: prev ? prev.to : 'Dhaka (DAC)',
        fromCity: prev ? prev.toCity : 'Dhaka',
        fromCode: prev ? prev.toCode : 'DAC',
        to: '',
        toCity: '',
        toCode: '',
        date: prev && prev.date ? prev.date : getDhakaDateString(3 + legs.length)
      });
      this.renderMultiCityLegs();
      this.saveState();
    },

    removeMultiCityLeg(index) {
      if (this.state.multiCityLegs.length <= this.config.minMultiCityLegs) {
        this.showAlert(`Multi-City requires at least ${this.config.minMultiCityLegs} flight segments.`);
        return;
      }
      this.state.multiCityLegs.splice(index, 1);
      this.renderMultiCityLegs();
      this.saveState();
    },

    swapMultiCityLeg(index) {
      const leg = this.state.multiCityLegs[index];
      if (!leg) return;
      [leg.from, leg.to] = [leg.to, leg.from];
      [leg.fromCity, leg.toCity] = [leg.toCity, leg.fromCity];
      [leg.fromCode, leg.toCode] = [leg.toCode, leg.fromCode];
      this.renderMultiCityLegs();
      this.saveState();
    },

    renderMultiCityLegs() {
      const container = document.getElementById('multiCityLegsList');
      if (!container) return;
      const todayStr = getDhakaDateString(0);
      const legs = this.state.multiCityLegs;

      container.innerHTML = legs.map((leg, idx) => {
        const minLegDate = (idx > 0 && legs[idx - 1].date && legs[idx - 1].date > todayStr) ? legs[idx - 1].date : todayStr;
        if (leg.date && leg.date < minLegDate) leg.date = minLegDate;
        return `
          <div class="multicity-leg-row" data-leg-index="${idx}">
            <span class="multicity-leg-badge">Flight ${idx + 1}</span>
            <div class="form-group-airport">
              <label class="input-label" for="mcOriginInput_${idx}">FROM</label>
              <div class="input-airport-wrapper">
                <input type="text" id="mcOriginInput_${idx}" class="airport-input" placeholder="Departure airport..." value="${esc(leg.from || '')}" autocomplete="off">
              </div>
              <div class="airport-dropdown-list" id="mcOriginDropdown_${idx}" role="listbox"></div>
            </div>
            <button type="button" class="btn-swap" onclick="FlightSearchWidget.swapMultiCityLeg(${idx})" title="Swap Airports" aria-label="Swap origin and destination for flight ${idx + 1}">&#8646;</button>
            <div class="form-group-airport">
              <label class="input-label" for="mcDestInput_${idx}">TO</label>
              <div class="input-airport-wrapper">
                <input type="text" id="mcDestInput_${idx}" class="airport-input" placeholder="Arrival airport..." value="${esc(leg.to || '')}" autocomplete="off">
              </div>
              <div class="airport-dropdown-list" id="mcDestDropdown_${idx}" role="listbox"></div>
            </div>
            <div class="form-group-field">
              <label class="input-label" for="mcDateInput_${idx}">DEPARTURE</label>
              <div class="input-field-wrapper">
                <input type="date" id="mcDateInput_${idx}" class="date-input" min="${minLegDate}" value="${esc(leg.date || '')}" aria-label="Departure date for flight ${idx + 1}">
              </div>
            </div>
            ${legs.length > this.config.minMultiCityLegs ? `
              <button type="button" class="btn-remove-leg" onclick="FlightSearchWidget.removeMultiCityLeg(${idx})" title="Remove Flight ${idx + 1}" aria-label="Remove flight ${idx + 1}">&times;</button>
            ` : '<div style="width:40px;"></div>'}
          </div>`;
      }).join('');

      legs.forEach((leg, idx) => {
        this.bindAirportInput(`mcOriginInput_${idx}`, `mcOriginDropdown_${idx}`, (sel) => {
          const code = sel.IATA || sel.ICAO || '';
          leg.from = `${sel.city} (${code})`;
          leg.fromCity = sel.city;
          leg.fromCode = code;
          const inp = document.getElementById(`mcOriginInput_${idx}`);
          if (inp) inp.value = leg.from;
          this.saveState();
        });
        this.bindAirportInput(`mcDestInput_${idx}`, `mcDestDropdown_${idx}`, (sel) => {
          const code = sel.IATA || sel.ICAO || '';
          leg.to = `${sel.city} (${code})`;
          leg.toCity = sel.city;
          leg.toCode = code;
          const inp = document.getElementById(`mcDestInput_${idx}`);
          if (inp) inp.value = leg.to;
          this.saveState();
        });
        const mcOriginInp = document.getElementById(`mcOriginInput_${idx}`);
        if (mcOriginInp) {
          mcOriginInp.addEventListener('input', () => {
            leg.from = mcOriginInp.value;
            leg.fromCode = parseAirportCode(mcOriginInp.value);
            leg.fromCity = parseCityName(mcOriginInp.value);
          });
        }
        const mcDestInp = document.getElementById(`mcDestInput_${idx}`);
        if (mcDestInp) {
          mcDestInp.addEventListener('input', () => {
            leg.to = mcDestInp.value;
            leg.toCode = parseAirportCode(mcDestInp.value);
            leg.toCity = parseCityName(mcDestInp.value);
          });
        }
        const dInp = document.getElementById(`mcDateInput_${idx}`);
        if (dInp) {
          dInp.addEventListener('change', () => {
            leg.date = dInp.value;
            this.renderMultiCityLegs();
            this.saveState();
          });
        }
      });
    },

    validate() {
      const todayStr = getDhakaDateString(0);
      const errors = {};
      const s = this.state;

      if (s.tripType === 'oneway' || s.tripType === 'roundtrip') {
        const origInput = document.getElementById('homeOriginInput');
        const destInput = document.getElementById('homeDestInput');
        const depInput = document.getElementById('homeDepDate');
        const retInput = document.getElementById('homeReturnDate');

        const fromRaw = (origInput ? origInput.value : s.origin.raw || '').trim();
        const toRaw = (destInput ? destInput.value : s.destination.raw || '').trim();
        const depDate = (depInput ? depInput.value : s.depDate || '').trim();
        const retDate = (retInput ? retInput.value : s.returnDate || '').trim();

        const fromCode = parseAirportCode(fromRaw) || s.origin.code || parseCityName(fromRaw);
        const toCode = parseAirportCode(toRaw) || s.destination.code || parseCityName(toRaw);

        if (!fromRaw) errors.origin = 'Please enter a departure city or airport.';
        if (!toRaw) errors.destination = 'Please enter a destination city or airport.';
        else if (fromCode && toCode && String(fromCode).toLowerCase() === String(toCode).toLowerCase()) {
          errors.destination = 'Origin and destination airports cannot be the same.';
        }

        if (!depDate) errors.depDate = 'Departure date is required.';
        else if (depDate < todayStr) errors.depDate = `Departure date cannot be in the past (${todayStr}).`;

        if (s.tripType === 'roundtrip') {
          if (!retDate) errors.returnDate = 'Return date is required for Round Trip.';
          else if (depDate && retDate < depDate) errors.returnDate = 'Return date cannot be earlier than departure date.';
        }
      } else {
        const legs = s.multiCityLegs;
        for (let i = 0; i < legs.length; i++) {
          const l = legs[i];
          const fCode = parseAirportCode(l.from) || l.fromCode || parseCityName(l.from);
          const tCode = parseAirportCode(l.to) || l.toCode || parseCityName(l.to);
          if (!l.from || !l.from.trim()) { errors.multiCity = `Flight ${i + 1}: Departure airport is required.`; break; }
          if (!l.to || !l.to.trim()) { errors.multiCity = `Flight ${i + 1}: Destination airport is required.`; break; }
          if (fCode && tCode && fCode.toLowerCase() === tCode.toLowerCase()) { errors.multiCity = `Flight ${i + 1}: Origin and destination cannot be the same.`; break; }
          if (!l.date) { errors.multiCity = `Flight ${i + 1}: Departure date is required.`; break; }
          if (l.date < todayStr) { errors.multiCity = `Flight ${i + 1}: Past dates are not permitted.`; break; }
          if (i > 0 && legs[i - 1].date && l.date < legs[i - 1].date) { errors.multiCity = `Flight ${i + 1}: Date cannot precede Flight ${i}.`; break; }
        }
      }

      const isValid = Object.keys(errors).length === 0;
      this.setFieldMessage('originError', errors.origin, 'originGroup');
      this.setFieldMessage('destError', errors.destination, 'destGroup');
      this.setFieldMessage('depDateError', errors.depDate, 'departureDateField');
      this.setFieldMessage('returnDateError', errors.returnDate, 'returnDateField');
      if (!isValid) {
        this.showAlert(Object.values(errors)[0]);
      } else {
        this.showAlert('');
      }
      return { isValid, errors };
    },

    resetSearchButtons() {
      const btnHome = document.getElementById('btnHomeSearch');
      const btnMulti = document.getElementById('btnMultiCitySearch');
      if (btnHome) {
        btnHome.disabled = false;
        btnHome.removeAttribute('aria-busy');
        btnHome.innerHTML = '<span>Search Flights</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" class="search-arrow-icon" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      }
      if (btnMulti) {
        btnMulti.disabled = false;
        btnMulti.removeAttribute('aria-busy');
        btnMulti.innerHTML = '<span>Search Multi-City Flights</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" class="search-arrow-icon" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      }
    },

    async handleSubmit(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (this.state.isSubmitting) return;

      const { isValid } = this.validate();
      if (!isValid) return;

      this.state.isSubmitting = true;
      const isMulti = this.state.tripType === 'multicity';
      const activeBtn = document.getElementById(isMulti ? 'btnMultiCitySearch' : 'btnHomeSearch');
      if (activeBtn) {
        activeBtn.disabled = true;
        activeBtn.setAttribute('aria-busy', 'true');
        activeBtn.innerHTML = '<span>Searching Flights...</span>';
      }

      const params = new URLSearchParams();
      params.set('tripType', this.state.tripType);
      params.set('cabin', 'Economy');
      params.set('adults', '1'); // Initial passenger-independent shopping baseline per API

      const apiParams = new URLSearchParams();
      if (isMulti) {
        const legs = this.state.multiCityLegs;
        legs.forEach((leg, idx) => {
          const fc = parseAirportCode(leg.from) || leg.fromCode || parseCityName(leg.from);
          const tc = parseAirportCode(leg.to) || leg.toCode || parseCityName(leg.to);
          params.set(`from${idx + 1}`, fc);
          params.set(`to${idx + 1}`, tc);
          params.set(`departure${idx + 1}`, leg.date);
        });
        const firstLeg = legs[0];
        const fc0 = parseAirportCode(firstLeg.from) || firstLeg.fromCode || parseCityName(firstLeg.from);
        const tc0 = parseAirportCode(firstLeg.to) || firstLeg.toCode || parseCityName(firstLeg.to);
        params.set('from', fc0);
        params.set('to', tc0);
        params.set('departure', firstLeg.date);
        apiParams.set('from', fc0);
        apiParams.set('to', tc0);
        apiParams.set('departure', firstLeg.date);
      } else {
        const origInput = document.getElementById('homeOriginInput');
        const destInput = document.getElementById('homeDestInput');
        const depInput = document.getElementById('homeDepDate');
        const retInput = document.getElementById('homeReturnDate');

        const fromRaw = (origInput ? origInput.value : this.state.origin.raw || '').trim();
        const toRaw = (destInput ? destInput.value : this.state.destination.raw || '').trim();
        const fromCode = parseAirportCode(fromRaw) || parseCityName(fromRaw);
        const toCode = parseAirportCode(toRaw) || parseCityName(toRaw);
        const depDate = depInput ? depInput.value : this.state.depDate;
        const retDate = retInput ? retInput.value : this.state.returnDate;

        params.set('from', fromCode);
        params.set('to', toCode);
        params.set('departure', depDate);
        apiParams.set('from', fromCode);
        apiParams.set('to', toCode);
        apiParams.set('departure', depDate);

        if (this.state.tripType === 'roundtrip' && retDate) {
          params.set('return', retDate);
          apiParams.set('return', retDate);
        }
      }

      try {
        const resp = await fetch('/api/flights?' + apiParams.toString(), { credentials: 'same-origin' });
        const payload = await resp.json();
        if (!resp.ok) {
          this.showAlert((payload && payload.error) || 'Flight search could not be completed.');
          this.state.isSubmitting = false;
          this.resetSearchButtons();
          return;
        }
        try {
          sessionStorage.setItem('fly_last_search_results', JSON.stringify(payload));
        } catch (_) {}
        this.saveState();
        this.state.isSubmitting = false;
        window.location.href = '/flights/search?' + params.toString();
      } catch (_) {
        this.showAlert('Network error while contacting flight search backend. Please retry.');
        this.state.isSubmitting = false;
        this.resetSearchButtons();
      }
    },

    // Hotels & Car Rentals Initialization & Submit
    initHotelsAndCarsDefaults() {
      const today = getDhakaDateString(0);
      const hIn = document.getElementById('hotelCheckIn');
      const hOut = document.getElementById('hotelCheckOut');
      if (hIn) {
        hIn.min = today;
        if (!hIn.value) hIn.value = getDhakaDateString(3);
        hIn.addEventListener('change', () => {
          if (hOut) {
            const minOut = addDaysToIso(hIn.value || today, 1);
            hOut.min = minOut;
            if (!hOut.value || hOut.value <= hIn.value) hOut.value = minOut;
          }
        });
      }
      if (hOut) {
        hOut.min = addDaysToIso((hIn && hIn.value) || today, 1);
        if (!hOut.value) hOut.value = getDhakaDateString(6);
      }

      const hBtn = document.getElementById('btnSearchHotels');
      if (hBtn) {
        hBtn.addEventListener('click', (e) => this.submitHotels(e));
      }

      const cSame = document.getElementById('carSameLocation');
      const cDropGrp = document.getElementById('carDropoffGroup');
      const cPick = document.getElementById('carPickupDate');
      const cRet = document.getElementById('carReturnDate');
      if (cSame && cDropGrp) {
        const syncSame = () => {
          cDropGrp.style.display = cSame.checked ? 'none' : 'flex';
        };
        cSame.addEventListener('change', syncSame);
        syncSame();
      }
      if (cPick) {
        cPick.min = today;
        if (!cPick.value) cPick.value = getDhakaDateString(3);
        cPick.addEventListener('change', () => {
          if (cRet) {
            cRet.min = cPick.value || today;
            if (cRet.value && cRet.value < cPick.value) cRet.value = cPick.value;
          }
        });
      }
      if (cRet) {
        cRet.min = (cPick && cPick.value) || today;
        if (!cRet.value) cRet.value = getDhakaDateString(5);
      }
      const cBtn = document.getElementById('btnSearchCars');
      if (cBtn) {
        cBtn.addEventListener('click', (e) => this.submitCars(e));
      }
    },

    async submitHotels(e) {
      if (e && e.preventDefault) e.preventDefault();
      this.showAlert('');
      const today = getDhakaDateString(0);
      const dest = (document.getElementById('hotelDestInput')?.value || '').trim();
      const checkIn = document.getElementById('hotelCheckIn')?.value || '';
      const checkOut = document.getElementById('hotelCheckOut')?.value || '';
      const rooms = document.getElementById('hotelRoomsSelect')?.value || '1';
      const adults = document.getElementById('hotelAdultsSelect')?.value || '2';
      const children = document.getElementById('hotelChildrenSelect')?.value || '0';

      if (!dest) { this.showAlert('Please enter a hotel destination city.'); return; }
      if (!checkIn || checkIn < today) { this.showAlert(`Check-in date must be today (${today}) or later.`); return; }
      if (!checkOut || checkOut <= checkIn) { this.showAlert('Check-out date must be after check-in date.'); return; }
      if (Number(rooms) > Number(adults)) { this.showAlert('Number of rooms cannot exceed adult guests.'); return; }

      const qs = new URLSearchParams({ destination: dest, checkIn, checkOut, rooms, adults, children });
      try {
        const res = await fetch('/api/hotels/search?' + qs.toString());
        const data = await res.json();
        if (!res.ok) {
          this.showAlert(data.error || 'Invalid hotel search parameters.');
          return;
        }
        window.location.href = '/hotels/search?' + qs.toString();
      } catch (_) {
        this.showAlert('Could not reach hotel search service.');
      }
    },

    async submitCars(e) {
      if (e && e.preventDefault) e.preventDefault();
      this.showAlert('');
      const today = getDhakaDateString(0);
      const pickupLocation = (document.getElementById('carPickupLoc')?.value || '').trim();
      const sameLocation = Boolean(document.getElementById('carSameLocation')?.checked);
      const dropoffLocation = sameLocation ? pickupLocation : (document.getElementById('carDropoffLoc')?.value || '').trim();
      const pickupDate = document.getElementById('carPickupDate')?.value || '';
      const pickupTime = document.getElementById('carPickupTime')?.value || '10:00';
      const returnDate = document.getElementById('carReturnDate')?.value || '';
      const returnTime = document.getElementById('carReturnTime')?.value || '10:00';
      const driverAge = document.getElementById('carDriverAge')?.value || '25';

      if (!pickupLocation) { this.showAlert('Pickup location is required.'); return; }
      if (!dropoffLocation) { this.showAlert('Drop-off location is required.'); return; }
      if (!pickupDate || pickupDate < today) { this.showAlert(`Pickup date must be today (${today}) or later.`); return; }
      if (!returnDate || returnDate < pickupDate) { this.showAlert('Return date must be on or after pickup date.'); return; }
      if (returnDate === pickupDate && returnTime <= pickupTime) { this.showAlert('For same-day rentals, return time must be after pickup time.'); return; }
      if (Number(driverAge) < 21) { this.showAlert('Minimum driver age is 21 years.'); return; }

      const qs = new URLSearchParams({ pickupLocation, dropoffLocation, sameLocation: String(sameLocation), pickupDate, pickupTime, returnDate, returnTime, driverAge });
      try {
        const res = await fetch('/api/cars/search?' + qs.toString());
        const data = await res.json();
        if (!res.ok) {
          this.showAlert(data.error || 'Invalid car rental search parameters.');
          return;
        }
        window.location.href = '/cars/search?' + qs.toString();
      } catch (_) {
        this.showAlert('Could not reach car rental search service.');
      }
    },

    quickFilterSearch(fromCity, toCity) {
      const codeMap = {};
      LOCAL_AIRPORT_CATALOG.forEach(a => { codeMap[a.city.toLowerCase()] = a; });
      const origMatch = codeMap[String(fromCity).toLowerCase()];
      const destMatch = codeMap[String(toCity).toLowerCase()];
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');

      if (origInput && origMatch) {
        origInput.value = `${origMatch.city} (${origMatch.IATA})`;
        this.state.origin = { city: origMatch.city, code: origMatch.IATA, raw: origInput.value };
      }
      if (destInput && destMatch) {
        destInput.value = `${destMatch.city} (${destMatch.IATA})`;
        this.state.destination = { city: destMatch.city, code: destMatch.IATA, raw: destInput.value };
      }
      this.switchProductTab('flights');
      this.handleSubmit();
    },

    selectPopularDestination(fromCity, toCity, toCode) {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      if (origInput && !origInput.value.trim()) {
        origInput.value = `${fromCity} (DAC)`;
        this.state.origin = { city: fromCity, code: 'DAC', raw: origInput.value };
      }
      if (destInput) {
        destInput.value = `${toCity} (${toCode})`;
        this.state.destination = { city: toCity, code: toCode, raw: destInput.value };
      }
      this.switchProductTab('flights');
      this.clearAllValidation();
      this.saveState();

      const widget = document.getElementById('searchWidgetContainer');
      if (widget && typeof widget.scrollIntoView === 'function') {
        widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },

    clearHomeSearch() {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      const depInput = document.getElementById('homeDepDate');
      const retInput = document.getElementById('homeReturnDate');
      if (origInput) origInput.value = 'Dhaka (DAC)';
      if (destInput) destInput.value = '';
      if (depInput) depInput.value = getDhakaDateString(3);
      if (retInput) retInput.value = '';
      this.state.origin = { city: 'Dhaka', code: 'DAC', raw: 'Dhaka (DAC)' };
      this.state.destination = { city: '', code: '', raw: '' };
      this.state.depDate = getDhakaDateString(3);
      this.state.returnDate = '';
      this.clearAllValidation();
      this.saveState();
    },

    updateUI() {
      const origInput = document.getElementById('homeOriginInput');
      const destInput = document.getElementById('homeDestInput');
      const depInput = document.getElementById('homeDepDate');
      const retInput = document.getElementById('homeReturnDate');
      if (origInput && this.state.origin.raw) origInput.value = this.state.origin.raw;
      if (destInput && this.state.destination.raw) destInput.value = this.state.destination.raw;
      if (depInput && this.state.depDate) depInput.value = this.state.depDate;
      if (retInput && this.state.returnDate) retInput.value = this.state.returnDate;
      this.switchProductTab(this.state.activeProduct || 'flights');
    }
  };

  // Compatibility bridge for inline card/button handlers on home.html
  if (typeof window !== 'undefined') {
    window.app = window.app || {};
    window.app.setTripType = (t) => FlightSearchWidget.setTripType(t);
    window.app.swapHomeAirports = () => FlightSearchWidget.swapAirports();
    window.app.quickFilterSearch = (f, t) => FlightSearchWidget.quickFilterSearch(f, t);
    window.app.selectPopularDestination = (f, t, c) => FlightSearchWidget.selectPopularDestination(f, t, c);
    window.app.clearHomeSearch = () => FlightSearchWidget.clearHomeSearch();
    window.app.addMultiCityLeg = () => FlightSearchWidget.addMultiCityLeg();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => FlightSearchWidget.init());
    } else {
      setTimeout(() => FlightSearchWidget.init(), 0);
    }
  }
  return FlightSearchWidget;
}));
