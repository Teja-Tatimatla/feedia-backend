const fs = require('fs');
const path = require('path');
const geolib = require('geolib');

function findClosestOpenPantries(lat, lon, day, time, travelMode, jsonFilePath, kitchenAvailable = true, canTravel = true, foodPreferences = []) {
  const pantriesData = JSON.parse(fs.readFileSync(jsonFilePath), 'utf8');

  const openPantries = pantriesData.filter(pantry => {
    const isOpen = pantry.hours?.some(hour => {
      return hour.day?.toLowerCase() === day.toLowerCase() && hour.open <= time && time <= hour.close;
    });

    if (!isOpen) return false;

    if (!kitchenAvailable) {
      const format = pantry.foodFormat?.join(' ').toLowerCase() || '';
      if (!format.includes('prepared') && !format.includes('hot') && !format.includes('meal')) return false;
    }

    if (!canTravel) {
      const dist = (pantry.distributionModels || []).join(', ').toLowerCase();
      if (!dist.includes('home delivery')) return false;
    }

    if (foodPreferences.length > 0) {
      const availableRestrictions = (pantry.dietaryRestrictions || []).map(d => d.toLowerCase());
      const hasAll = foodPreferences.every(pref => availableRestrictions.includes(pref.toLowerCase()));
      if (!hasAll) return false;
    }

    return true;
  });

  const sortedPantries = openPantries
    .map(pantry => ({
      ...pantry,
      distance: geolib.getDistance(
        { latitude: lat, longitude: lon },
        { latitude: pantry.latitude, longitude: pantry.longitude }
      ),
      mapsLink: `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${pantry.latitude},${pantry.longitude}&travelmode=${travelMode}`
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  return sortedPantries;
}

module.exports = { findClosestOpenPantries };