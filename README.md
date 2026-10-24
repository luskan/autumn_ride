# Jesienna Trasa

Gra 3D w przeglądarce (three.js): jazda samochodem przez jesienną, pagórkowatą okolicę z ruchem w obu kierunkach i polskimi znakami drogowymi. Zagraj online: https://luskan.github.io/autumn_ride/

Jesienne tło ożywiają odległe klucze i pojedyncze ptaki oraz małe grupy startujące i lądujące za koronami drzew. Częstotliwość przelotów, odległości i limity ptaków można dostroić w `BIRDS` w `src/config.js`.

W leśnych odcinkach przy drzewach o kolorowych koronach leżą różnej wielkości kupki liści. Część jest na poboczu, część nawiało dalej na pasy; pojedyncze kupki leżą też pod drzewami na polach. Zahaczenie o kupkę samochodem rozrzuca liście w powietrzu; po pewnym czasie kupka pojawia się ponownie.

Sterowanie: strzałki (góra - gaz, dół - hamowanie i po zatrzymaniu cofanie, lewo/prawo - skręt), A - autopilot (trzyma prędkość i wyprzedza), C - kamera (także widok z miejsca kierowcy bez wnętrza auta), M - dźwięk, P - pauza, mysz - obrót i przybliżenie kamery. Przyciski PL/EN u góry przełączają język gry; domyślny jest polski. Na telefonie (w poziomie) sterowanie jak w Roblox: joystick pod lewym kciukiem (w dół - hamowanie i cofanie), przeciąganie po prawej stronie obraca kamerę. Podczas cofania prędkościomierz pokazuje R, a prędkość jest ograniczona do około 22 km/h. Strzałka w górę lub joystick w górę zatrzymuje cofanie i rusza do przodu.

Lokalnie: `npm install`, potem `npm run dev`; `npm run build` tworzy jeden samodzielny plik `dist/index.html`, a `npm test` uruchamia testy e2e w Chrome. Własne logo na ciężarówkach: plik `src/assets/truck-logo.png`.
