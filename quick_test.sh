#!/bin/bash
# Quick test script
API_URL=${1:-http://localhost:3000}
LOCATION=${2:-gb/london/EGLC}

echo "Testing: $API_URL/api/weather/latest?location=$LOCATION"
echo ""
curl -s "$API_URL/api/weather/latest?location=$LOCATION" | python3 -m json.tool 2>/dev/null || curl -s "$API_URL/api/weather/latest?location=$LOCATION"
