const axios = require('axios');
const haversine = require('haversine');
const config = require('./config');

const CITY_COORDS = {
  'Miami':             { latitude: 25.7617, longitude: -80.1918 },
  'Atlanta':           { latitude: 33.7490, longitude: -84.3880 },
  'Atlanta, Georgia':  { latitude: 33.7490, longitude: -84.3880 },
  'New York':          { latitude: 40.7128, longitude: -74.0060 },
  'Los Angeles':       { latitude: 34.0522, longitude: -118.2437 },
  'Chicago':           { latitude: 41.8781, longitude: -87.6298 },
  'Dallas':            { latitude: 32.7767, longitude: -96.7970 },
  'Seattle':           { latitude: 47.6062, longitude: -122.3321 },
  'San Jose':          { latitude: 37.3382, longitude: -121.8863 },
  'Phoenix':           { latitude: 33.4484, longitude: -112.0740 },
  'Denver':            { latitude: 39.7392, longitude: -104.9903 },
  'Minneapolis':       { latitude: 44.9778, longitude: -93.2650 },
  'Portland':          { latitude: 45.5051, longitude: -122.6750 },
  'Charlotte':         { latitude: 35.2271, longitude: -80.8431 },
  'Washington':        { latitude: 38.9072, longitude: -77.0369 },
  'Boston':            { latitude: 42.3601, longitude: -71.0589 },
  'Las Vegas':         { latitude: 36.1699, longitude: -115.1398 },
  'Salt Lake City':    { latitude: 40.7608, longitude: -111.8910 },
  'Kansas City':       { latitude: 39.0997, longitude: -94.5786 },
  'Tampa':             { latitude: 27.9506, longitude: -82.4572 },
};

function classifyTier(currentload) {
  const t = config.TIER_THRESHOLDS;
  if (currentload <= t.low.max)    return 'low';
  if (currentload <= t.medium.max) return 'medium';
  if (currentload <= t.high.max)   return 'high';
  return 'diablo';
}

function computeDistance(server) {
  const coords = server.latitude != null && server.longitude != null
    ? { latitude: server.latitude, longitude: server.longitude }
    : CITY_COORDS[server.location];

  if (!coords) return null;

  return Math.round(
    haversine(
      { latitude: config.CAPE_CORAL_LAT, longitude: config.CAPE_CORAL_LON },
      coords,
      { unit: 'km' }
    )
  );
}

async function fetchUSServers() {
  const response = await axios.get(config.AIRVPN_STATUS_URL, { timeout: 30000 });
  const servers = response.data.servers || [];

  return servers
    .filter(s => s.country_code === 'us' && s.health === 'ok')
    .map(s => ({
      ...s,
      available_capacity_mbps: s.bw_max - s.bw,
      tier: classifyTier(s.currentload),
      distance_km: computeDistance(s),
    }));
}

module.exports = { fetchUSServers, classifyTier };
