# Ariston Nuos for Homey

Unofficial Homey Pro app ([Pepane13/Ariston-Nuos](https://github.com/Pepane13/Ariston-Nuos)) for an **Ariston Nuos** heat pump water heater, through the Ariston NET cloud. It replaces the community app `com.ariston`, which is no longer maintained and has left the Homey App Store.

The app is a plain device driver: it shows the state of the water heater and executes the commands of the Homey app and of your Flows. It takes no decision of its own; the hot water logic stays in your Flows.

> Not affiliated with Ariston. The Ariston NET API is not publicly documented: it can change without notice. Endpoints follow the reverse-engineered [python-ariston-api](https://github.com/fustom/python-ariston-api) project. The app is meant for a **local install** (`homey app install`), not for the App Store.

## Install from GitHub, without a PC

The workflow **Publish to Homey** builds and uploads the app to Homey Developer Tools straight from this repository.

One-time setup:
1. Create a personal access token at https://tools.developer.homey.app/me.
2. In this repository: **Settings → Secrets and variables → Actions → New repository secret**, name `HOMEY_PAT`, value the token.

Each new version (from a browser or the GitHub mobile app):
1. **Actions → Publish to Homey → Run workflow**, choose patch / minor / major and write what's new.
2. The workflow increases the version, runs the tests, validates the app, uploads it to Homey Developer Tools, then commits the version and tags it (`vX.Y.Z`).
3. In Homey Developer Tools (link in the run summary): build → **Release to Test**, then open the test link on the phone and install or update the app on the Homey.

The workflow **Validate** runs the tests and the Homey validation on every push.

## Install from a Windows PC

`install.cmd` downloads the latest version from GitHub (no git needed) and runs `homey app install`. `install.cmd local` installs the local files next to the script instead.

## First use

Homey app → **Devices → + → Ariston Nuos**, sign in with the Ariston NET account (same e-mail and password as the Ariston app).

## Device

| Capability | |
|---|---|
| Water heater on/off | Settable |
| Water temperature | Insights |
| Target temperature | Settable (limits read from the heater) |
| Mode: Green, Comfort, Fast, i-Memory | Settable |
| Boost | Settable |
| Heat pump running | Insights |
| Heat pump and resistor energy, last day | From the Ariston consumption report (Insights) |

The device has no `measure_power`/`meter_power`, so it stays out of Homey Energy: measure the heater with a dedicated meter if needed.

The cloud is read every 2 minutes (device setting), and again 20 seconds after each command to show what the heater actually took. The Ariston cloud rate-limits requests (HTTP 429): keep the interval at 2 minutes or more.

## Flow cards

- **When**: water temperature becomes higher / lower than · target temperature changed · boost on for a duration · heat pump running for a duration · the mode changed · the Ariston cloud is unreachable
- **And**: mode is · boost is on · heat pump is running
- **Then**: set the temperature · set the mode · switch boost · turn on / off · refresh from the cloud

## Development

```
cd com.pepane13.ariston
homey app validate --level publish
homey app run            # live logs
node --test ../test/ariston.test.js
```

`tools/build_app_json.py` generates `app.json` (settings, capabilities and Flow cards).

Version 1.0.x contained an automatic strategy (solar, battery, Tempo, anti-legionella). It was removed in 2.0.0: Flows are simpler to read and adjust. When upgrading, the device drops the strategy capabilities by itself; Flows using the removed strategy cards must be updated.

## License

GPL-3.0-or-later
