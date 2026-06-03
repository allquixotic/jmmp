// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { register } from 'register-service-worker';
import {
  reloadOnceOnControllerChange,
  requestWaitingWorkerActivation,
} from './service-worker-update';

// The ready(), registered(), cached(), updatefound() and updated()
// events passes a ServiceWorkerRegistration instance in their arguments.
// ServiceWorkerRegistration: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration

const autoReloadUpdates = process.env.PROD;

if (autoReloadUpdates && 'serviceWorker' in navigator) {
  reloadOnceOnControllerChange(navigator.serviceWorker, window.location);
}

register(process.env.SERVICE_WORKER_FILE, {
  // The registrationOptions object will be passed as the second argument
  // to ServiceWorkerContainer.register()
  // https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#Parameter

  // registrationOptions: { scope: './' },

  ready (/* registration */) {
    // console.log('Service worker is active.')
  },

  registered (/* registration */) {
    // console.log('Service worker has been registered.')
  },

  cached (/* registration */) {
    // console.log('Content has been cached for offline use.')
  },

  updatefound (/* registration */) {
    // console.log('New content is downloading.')
  },

  updated (registration) {
    if (autoReloadUpdates) requestWaitingWorkerActivation(registration);
  },

  offline () {
    // console.log('No internet connection found. App is running in offline mode.')
  },

  error (/* err */) {
    // console.error('Error during service worker registration:', err)
  },
});
