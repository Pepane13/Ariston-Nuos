# Ariston Nuos for Homey

Unofficial Homey Pro app that controls an **Ariston Nuos** heat pump water heater through the Ariston NET cloud, and runs the hot water strategy inside the app instead of in Flows: solar production, full home battery, off-peak night top-up, **EDF Tempo** and a monthly anti-legionella cycle.

It replaces the community app `com.ariston`, which is no longer maintained and has left the Homey App Store.

> Not affiliated with Ariston. The Ariston NET API is not publicly documented: it can change without notice. Endpoints follow the reverse-engineered [python-ariston-api](https://github.com/fustom/python-ariston-api) project. The app is meant for a **local install** (`homey app install`), not for the App Store.

## Install (Windows)

1. Double-click `install.cmd` at the root of the repository. It checks Node.js (24+), installs or updates the Homey CLI, installs the app dependencies and runs `homey app install` (sign-in and Homey selection the first time).
2. Homey app → **Settings → Apps → Ariston Nuos → Configure**: choose the devices the strategy reads (each is optional).
   | Role | Capability read | Example |
   |---|---|---|
   | Solar production | `measure_power` | TSUN Micro-inverters |
   | Home battery | `measure_battery` | Marstek |
   | EV charger | `evcharger_charging_state` (or `measure_evse_state` ≥ 4) | Tesla Wall Connector |
   | Linky meter | `price_period_capability`, `today_color_capability`, `tomorrow_color_capability` | Lixee Linky |
3. **Devices → + → Ariston Nuos**, sign in with the Ariston NET account (same e-mail and password as the Ariston app).

## Strategy

Evaluated every minute. Highest priority first:

| Priority | Rule | Default |
|---|---|---|
| 1 | **Anti-legionella**, once a month | Strong sun (≥ 2,000 W for 15 min) from day 1 to 5; otherwise from day 28 at 22:30 in off-peak hours. 65 °C Comfort, done at 64 °C, aborted after 8 h, paused on Tempo red peak hours |
| 2 | **Manual change** (app tile or the `set mode` card) | Kept until the next daily reset |
| 3 | **Tempo red day, peak hours** | 40 °C Green, boost refused; solar and full battery still allowed |
| 4 | **Opportunities of the day** (highest wins) | Solar ≥ 500 W for 2 min → 52 °C Green · Battery ≥ 95 % while the sun is up → 55 °C Comfort · 23:00 off-peak, water < 50 °C → 52 °C Green · Night before a red day → 55 °C Comfort |
| 5 | **Base** | 45 °C Green |

Solar and battery rules are skipped while the car is charging. The daily reset (back to base, manual change cleared) happens when peak hours start and at the base time (17:00). A boost is switched off after 60 min. Every value is a device setting.

Commands are only sent when the heater differs from the target, and a command the heater did not take is repeated after 10 min at most: the Ariston cloud rate-limits requests (HTTP 429). A setpoint above the Green maximum of the heater switches to Comfort instead of being lowered.

## Device

| Capability | |
|---|---|
| Water heater on, water temperature, target temperature | Standard |
| Mode (Green, Comfort, Fast, i-Memory), Boost | Settable |
| Heat pump running | Insights |
| Automatic strategy | Switch off to drive the heater only from Flows or the app |
| Active rule, last anti-legionella | Status |
| Heat pump and resistor energy, last day | From the Ariston consumption report (Insights) |

The device has no `measure_power`/`meter_power`, so it stays out of Homey Energy: measure the heater with a dedicated meter if needed.

## Flow cards

- **When**: the active rule changed · the mode changed · anti-legionella cycle started / done · boost stopped by the app · the Ariston cloud is unreachable
- **And**: mode is · boost is on · heat pump is running · automatic strategy is on · active rule is · anti-legionella done this month
- **Then**: set the mode · switch boost · switch the automatic strategy · start an anti-legionella cycle now · cancel the manual change · refresh from the cloud

Timeline notifications (anti-legionella, boost stopped) can be switched off in the device settings.

## Development

```
cd com.pepane13.ariston
npm install
homey app validate --level publish
homey app run            # live logs
node --test ../test/controller.test.js   # strategy tests
```

`tools/build_app_json.py` generates `app.json` (settings, capabilities and Flow cards).

## License

GPL-3.0-or-later
