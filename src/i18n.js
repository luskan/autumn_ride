const STORAGE_KEY = 'jesienna-trasa-language';

const messages = {
  pl: {
    title: 'Jesienna Trasa',
    description: 'Spokojna jazda samochodem przez jesienną okolicę - gra 3D w przeglądarce.',
    language: 'Język',
    distance: 'Dystans', time: 'Czas', overtakes: 'Wyprzedzone', bumps: 'Stłuczki',
    autopilot: 'Autopilot', cameraLabel: 'kamera:', soundLabel: 'dźwięk:', pauseLabel: 'pauza',
    touchZone: 'Lewa strona: joystick jazdy, prawa strona: obrót kamery',
    changeCamera: 'Zmiana kamery', pause: 'Pauza',
    subtitle: 'Złota godzina, pagórki i kręta droga przez jesienną okolicę.',
    arrowUp: 'strzałka w górę', arrowDown: 'strzałka w dół',
    arrowLeft: 'strzałka w lewo', arrowRight: 'strzałka w prawo',
    accelerate: 'Przyspieszanie', brakeReverse: 'Hamowanie, po zatrzymaniu cofanie',
    steering: 'Skręt w lewo / w prawo', autopilotHelp: 'Autopilot: trzyma prędkość, wyprzedza',
    cameraHelp: 'Zmiana kamery (także widok kierowcy)', soundPause: 'Dźwięk / pauza', mouse: 'Mysz',
    mouseHelp: 'Przeciągnij - obrót kamery, kółko - zoom',
    touchHelp: 'Lewy kciuk: joystick - w górę gaz, w dół hamulec i cofanie, na boki skręt. Prawa strona ekranu: przeciągnij, aby obrócić kamerę, dwa palce przybliżają. U góry: autopilot, kamera (także widok kierowcy) i pauza.',
    roadNote: 'Jedziesz tylko po drodze - barierki trzymają auto na jezdni. Stłuczki nie uszkadzają samochodu.',
    start: 'Ruszaj', exit: 'Wyjdź z gry', startHint: 'albo naciśnij Enter / Spację',
    iosHint: 'Pełny ekran na iPhonie: Udostępnij → Do ekranu początkowego, potem uruchom grę z ikony.',
    pauseHelp: 'Naciśnij P lub Esc, aby jechać dalej.', resume: 'Wracam na trasę',
    loading: 'Ładowanie...', route: 'Wytyczanie trasy...', terrain: 'Kształtowanie terenu...',
    road: 'Malowanie drogi...', trees: 'Sadzenie drzew...', signs: 'Stawianie znaków...',
    cars: 'Wyprowadzanie aut...', engine: 'Rozgrzewanie silnika...',
    loadError: 'Nie udało się uruchomić gry: ',
    fullscreen: 'Pełny ekran', exitFullscreen: 'Wyjdź z pełnego ekranu',
    fullscreenError: 'Pełny ekran niedostępny - otwórz grę w nowej karcie',
    exitHint: 'Aby wyjść, przesuń od krawędzi ekranu i dotknij Wstecz',
    welcome: 'Szerokiej drogi!', autopilotOff: 'Autopilot wyłączony',
    autopilotSteering: 'Autopilot wyłączony - przejmujesz kierownicę',
    autopilotDriving: 'Autopilot wyłączony - przejmujesz sterowanie',
    collision: 'Stłuczka! Bez szkód - jedziemy dalej.',
    cameraChase: 'zza auta', cameraBird: 'z lotu ptaka',
    cameraDriver: 'z miejsca kierowcy', soundOn: 'wł.', soundOff: 'wył.',
    autoLane: 'trzyma pas', autoPassing: 'wyprzedza',
    autoReturning: 'wraca na pas', autoAbort: 'odpuszcza',
  },
  en: {
    title: 'Autumn Drive',
    description: 'A relaxing drive through the autumn countryside - a 3D browser game.',
    language: 'Language',
    distance: 'Distance', time: 'Time', overtakes: 'Overtaken', bumps: 'Collisions',
    autopilot: 'Autopilot', cameraLabel: 'camera:', soundLabel: 'sound:', pauseLabel: 'pause',
    touchZone: 'Left side: driving joystick; right side: rotate camera',
    changeCamera: 'Change camera', pause: 'Paused',
    subtitle: 'Golden hour, rolling hills and a winding road through the autumn countryside.',
    arrowUp: 'up arrow', arrowDown: 'down arrow',
    arrowLeft: 'left arrow', arrowRight: 'right arrow',
    accelerate: 'Accelerate', brakeReverse: 'Brake, then reverse when stopped',
    steering: 'Steer left / right', autopilotHelp: 'Autopilot: maintains speed and overtakes',
    cameraHelp: 'Change camera (including driver view)', soundPause: 'Sound / pause', mouse: 'Mouse',
    mouseHelp: 'Drag to rotate camera, scroll to zoom',
    touchHelp: 'Left thumb: joystick - up to accelerate, down to brake and reverse, sideways to steer. Drag on the right side to rotate the camera; pinch with two fingers to zoom. At the top: autopilot, camera (including driver view) and pause.',
    roadNote: 'Stay on the road - guardrails keep the car on the pavement. Collisions do not damage the car.',
    start: 'Drive', exit: 'Exit game', startHint: 'or press Enter / Space',
    iosHint: 'Full screen on iPhone: Share → Add to Home Screen, then launch the game from its icon.',
    pauseHelp: 'Press P or Esc to keep driving.', resume: 'Back to the road',
    loading: 'Loading...', route: 'Laying out the route...', terrain: 'Shaping terrain...',
    road: 'Painting the road...', trees: 'Planting trees...', signs: 'Placing road signs...',
    cars: 'Getting cars ready...', engine: 'Warming up the engine...',
    loadError: 'Could not start the game: ',
    fullscreen: 'Full screen', exitFullscreen: 'Exit full screen',
    fullscreenError: 'Full screen unavailable - open the game in a new tab',
    exitHint: 'To exit, swipe from the edge of the screen and tap Back',
    welcome: 'Enjoy the drive!', autopilotOff: 'Autopilot off',
    autopilotSteering: 'Autopilot off - you are steering',
    autopilotDriving: 'Autopilot off - you are driving',
    collision: 'Collision! No damage - keep driving.',
    cameraChase: 'behind the car', cameraBird: 'bird’s-eye view',
    cameraDriver: 'driver’s view', soundOn: 'on', soundOff: 'off',
    autoLane: 'staying in lane', autoPassing: 'overtaking',
    autoReturning: 'returning to lane', autoAbort: 'holding back',
  },
};

let language = 'pl';
try {
  if (localStorage.getItem(STORAGE_KEY) === 'en') language = 'en';
} catch {
  // Storage can be unavailable when the single-file build is opened locally.
}

export const getLanguage = () => language;
export const t = (key) => messages[language][key] ?? messages.pl[key] ?? key;

export function applyLanguage() {
  document.documentElement.lang = language;
  document.title = t('title');
  document.querySelector('meta[name="description"]').content = t('description');
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const button of document.querySelectorAll('#lang-switch button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === language));
  }
}

export function setLanguage(value) {
  if (value !== 'pl' && value !== 'en') return;
  language = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* See above. */ }
  applyLanguage();
}
