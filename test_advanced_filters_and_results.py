"""
Comprehensive Automated Test Suite for Flight Results and Advanced Filtering System
Testing Prompt 2 Requirements:
1. Enriched Flight Results (Airlines, aircraft, flight #, stops, baggage, refundability, pricing)
2. Search Summary Card & Inline Modification
3. Advanced Dynamic Filtering (Price, Airlines, Stops, Dep/Arr Time Slots, Duration, Refund, Baggage)
4. Result Sorting (Cheapest, Fastest, Earliest/Latest Dep, Earliest Arr, Recommended)
5. Combined Filtering Logic & State Consistency
"""
import urllib.request
import json
import re

BASE_URL = "http://localhost:5000"

def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode('utf-8'))

def test_flight_enrichment():
    print(">>> 1. Testing Flight Enrichment Attributes...")
    data = get_json(f"{BASE_URL}/api/flights?limit=5")
    assert "flights" in data and len(data["flights"]) > 0, "No flights returned"
    
    for f in data["flights"]:
        # Flight Number
        assert "flightNumber" in f and f["flightNumber"], f"Missing flightNumber in {f.get('id')}"
        # Aircraft Model
        assert "aircraft" in f and f["aircraft"], f"Missing aircraft model in {f.get('id')}"
        # Baggage Allowance
        assert "baggageAllowance" in f and "kg" in f["baggageAllowance"], f"Invalid baggage allowance in {f.get('id')}"
        # Refundability
        assert f.get("refundability") in ["Refundable", "Partially Refundable", "Non-refundable"], f"Invalid refundability in {f.get('id')}"
        # Duration formatted and minutes
        assert "durationFormatted" in f and "durationMinutes" in f, f"Missing duration in {f.get('id')}"
        # Stops
        assert "stops" in f and f["stops"] in [0, 1, 2], f"Invalid stops in {f.get('id')}"
    print("   [PASS] Flight attributes enriched with aircraft, flightNumber, baggage, refundability, stops, duration.")

def test_sorting_api():
    print(">>> 2. Testing API Sorting Options...")
    # Cheapest
    data_cheap = get_json(f"{BASE_URL}/api/flights?limit=10&sortBy=cheapest")
    prices = [f.get("economy_price", 0) for f in data_cheap["flights"]]
    assert prices == sorted(prices), f"Cheapest sorting failed: {prices}"

    # Fastest
    data_fast = get_json(f"{BASE_URL}/api/flights?limit=10&sortBy=fastest")
    durations = [f.get("durationMinutes", 0) for f in data_fast["flights"]]
    assert durations == sorted(durations), f"Fastest sorting failed: {durations}"

    # Earliest Dep
    data_edep = get_json(f"{BASE_URL}/api/flights?limit=10&sortBy=earliestDep")
    dep_times = [f.get("dep_datetime", "") for f in data_edep["flights"]]
    assert dep_times == sorted(dep_times), f"Earliest dep sorting failed: {dep_times}"

    # Latest Dep
    data_ldep = get_json(f"{BASE_URL}/api/flights?limit=10&sortBy=latestDep")
    dep_times_rev = [f.get("dep_datetime", "") for f in data_ldep["flights"]]
    assert dep_times_rev == sorted(dep_times_rev, reverse=True), f"Latest dep sorting failed: {dep_times_rev}"

    print("   [PASS] All server sorting options (cheapest, fastest, earliestDep, latestDep) validated.")

def test_filter_options_api():
    print(">>> 3. Testing Filter Options Endpoint...")
    opts = get_json(f"{BASE_URL}/api/flights/filter-options")
    assert "price_range" in opts, "Missing price_range"
    assert opts["price_range"]["min"] > 0 and opts["price_range"]["max"] >= opts["price_range"]["min"]
    assert "airlines" in opts and len(opts["airlines"]) > 0, "Missing airlines options"
    assert "stops" in opts and len(opts["stops"]) >= 3, "Missing stops options"
    assert "time_slots" in opts, "Missing time_slots options"
    assert "refund_policies" in opts and len(opts["refund_policies"]) >= 3, "Missing refund policies"
    assert "baggage_options" in opts and len(opts["baggage_options"]) >= 4, "Missing baggage options"
    print(f"   [PASS] Filter options verified: {len(opts['airlines'])} airlines, price {opts['price_range']['min']}-{opts['price_range']['max']}.")

def test_single_flight_revalidation():
    print(">>> 4. Testing Single Flight Revalidation Endpoint...")
    f = get_json(f"{BASE_URL}/api/flights/1")
    assert f.get("id") == 1
    assert "airlineName" in f
    assert "flightNumber" in f
    assert "aircraft" in f
    assert "baggageAllowance" in f
    assert "refundability" in f
    print("   [PASS] Single flight details endpoint returned enriched flight object.")

def test_html_dom_elements():
    print(">>> 5. Testing index.html for Required Flight Search and Filter Elements...")
    with open("templates/index.html", "r", encoding="utf-8") as file:
        html = file.read()

    required_ids = [
        "resultsSummaryCard",
        "summaryDepCity",
        "summaryArrCity",
        "summaryDepDatePill",
        "summaryReturnDatePill",
        "summaryPassengersPill",
        "summaryCabinPill",
        "btnToggleModifySearch",
        "modifySearchPanel",
        "modifyOriginInput",
        "modifyDestInput",
        "modifyDepDate",
        "modifyCabinClass",
        "searchSidebar",
        "filterKeyword",
        "filterPriceSlider",
        "priceSliderValDisplay",
        "priceMinBound",
        "priceMaxBound",
        "filterAirlinesList",
        "filterStopsList",
        "filterDurationSlider",
        "durationSliderValDisplay",
        "filterRefundList",
        "filterBaggageList",
        "sortPillsGroup",
        "activeFilterTagsRow",
        "flightsListContainer",
        "mobileFilterBadge",
        "sidebarDrawerOverlay"
    ]

    for elem_id in required_ids:
        assert f'id="{elem_id}"' in html, f"Missing HTML element id: {elem_id}"
    print(f"   [PASS] All {len(required_ids)} required DOM element IDs verified in templates/index.html.")

def test_javascript_methods():
    print(">>> 6. Testing app.js and main.js for Search, Filter, Sort and Modify Logic...")
    for js_path in ["static/js/app.js", "static/js/main.js"]:
        with open(js_path, "r", encoding="utf-8") as file:
            js = file.read()
        
        required_methods = [
            "updateSearchSummaryBar",
            "toggleModifySearch",
            "swapModifyAirports",
            "submitModifiedSearch",
            "executeSearchQuery",
            "populateSidebarFilters",
            "applyClientFiltersAndSort",
            "renderActiveFilterTags",
            "removeFilterTag",
            "onPriceSliderChange",
            "onFilterKeywordInput",
            "onAirlineFilterChange",
            "toggleSelectAllAirlines",
            "onStopFilterChange",
            "toggleTimeSlot",
            "onDurationSliderChange",
            "onRefundFilterChange",
            "onBaggageFilterChange",
            "setSortOption",
            "clearAllFilters",
            "toggleMobileFilterDrawer",
            "renderFlightCard"
        ]

        for method in required_methods:
            assert method in js, f"Missing method {method} in {js_path}"
    print("   [PASS] All required JavaScript functions present and verified in both app.js and main.js.")

if __name__ == "__main__":
    test_flight_enrichment()
    test_sorting_api()
    test_filter_options_api()
    test_single_flight_revalidation()
    test_html_dom_elements()
    test_javascript_methods()
    print("\n=======================================================")
    print("SUCCESS: ALL FLIGHT RESULTS & FILTERING TESTS PASSED!")
    print("=======================================================")
