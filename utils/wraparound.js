const fs = require('fs');
const path = require('path');
const geolib = require('geolib');

function findWraparoundServices(lat, lon, day, time, travelMode, filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const open = data.filter(p =>
    p.hours?.some(h => h.day?.toLowerCase() === day.toLowerCase() && h.open <= time && time <= h.close)
  );

  return open.map(p => ({
    ...p,
    distance: geolib.getDistance({ latitude: lat, longitude: lon }, { latitude: p.latitude, longitude: p.longitude }),
    mapsLink: `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${p.latitude},${p.longitude}&travelmode=${travelMode}`
  })).sort((a, b) => a.distance - b.distance).slice(0, 5);
}

module.exports = { findWraparoundServices };