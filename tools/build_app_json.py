#!/usr/bin/env python3
"""Generates com.pepane13.ariston/app.json (kept as a script so the long manifest stays consistent)."""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'com.pepane13.ariston')
VERSION = '1.0.0'


def t(en, fr):
    return {'en': en, 'fr': fr}


MODES = [
    ('green', t('Green', 'Green')),
    ('comfort', t('Comfort', 'Comfort')),
    ('fast', t('Fast', 'Fast')),
    ('imemory', t('i-Memory', 'i-Memory')),
]
MODE_VALUES = [{'id': k, 'label': v} for k, v in MODES]
MODE_ARG = {'type': 'dropdown', 'name': 'mode', 'title': t('Mode', 'Mode'), 'values': MODE_VALUES}

RULES = [
    ('base', t('Base', 'Base')),
    ('solar', t('Solar production', 'Production solaire')),
    ('battery', t('Full battery', 'Batterie pleine')),
    ('night', t('Night top-up', 'Appoint de nuit')),
    ('red_eve', t('Preheat before red day', 'Préchauffe veille de jour rouge')),
    ('red_peak', t('Tempo red, peak hours', 'Tempo rouge, heures pleines')),
    ('legionella', t('Anti-legionella', 'Anti-légionellose')),
    ('manual', t('Manual', 'Manuel')),
]

DEVICE = [{'type': 'device', 'name': 'device', 'filter': 'driver_id=nuos'}]
ON_OFF_ARG = {'type': 'dropdown', 'name': 'state', 'title': t('State', 'État'),
              'values': [{'id': 'on', 'label': t('On', 'Activé')}, {'id': 'off', 'label': t('Off', 'Désactivé')}]}


def num(id_, label, value, min_, max_, units, hint=None, step=1):
    s = {'id': id_, 'type': 'number', 'label': label, 'value': value, 'attr': {'min': min_, 'max': max_, 'step': step}, 'units': units}
    if hint:
        s['hint'] = hint
    return s


def chk(id_, label, value, hint=None):
    s = {'id': id_, 'type': 'checkbox', 'label': label, 'value': value}
    if hint:
        s['hint'] = hint
    return s


def txt(id_, label, value, hint=None):
    s = {'id': id_, 'type': 'text', 'label': label, 'value': value}
    if hint:
        s['hint'] = hint
    return s


def mode(id_, label, value):
    return {'id': id_, 'type': 'dropdown', 'label': label, 'value': value, 'values': MODE_VALUES}


def group(label, children):
    return {'type': 'group', 'label': label, 'children': children}


C = t('°C', '°C')
SETTINGS = [
    group(t('Base setpoint', 'Consigne de base'), [
        num('base_setpoint', t('Base setpoint', 'Consigne de base'), 45, 40, 75, C),
        mode('base_mode', t('Base mode', 'Mode de base'), 'green'),
        txt('base_time', t('Back to base at (HH:MM)', 'Retour à la base à (HH:MM)'), '17:00',
            t('Opportunities of the day (solar, battery, night) and manual changes end at this time and when peak hours start.',
              "Les opportunités du jour (solaire, batterie, nuit) et les changements manuels prennent fin à cette heure et au passage en heures pleines.")),
    ]),
    group(t('Solar production', 'Production solaire'), [
        chk('solar_enabled', t('Heat with solar production', 'Chauffer avec la production solaire'), True),
        num('solar_threshold', t('Production above', 'Production supérieure à'), 500, 50, 10000, t('W', 'W')),
        num('solar_duration', t('For at least', 'Pendant au moins'), 2, 1, 60, t('min', 'min')),
        num('solar_setpoint', t('Solar setpoint', 'Consigne solaire'), 52, 40, 75, C),
        mode('solar_mode', t('Solar mode', 'Mode solaire'), 'green'),
    ]),
    group(t('Full home battery', 'Batterie domestique pleine'), [
        chk('battery_enabled', t('Heat when the battery is full', 'Chauffer quand la batterie est pleine'), True,
            t('Only while the sun is up and the car is not charging.', 'Seulement en journée solaire et quand la voiture ne charge pas.')),
        num('battery_threshold', t('Battery above', 'Batterie au-dessus de'), 95, 50, 100, t('%', '%')),
        num('battery_setpoint', t('Battery setpoint', 'Consigne batterie'), 55, 40, 75, C),
        mode('battery_mode', t('Battery mode', 'Mode batterie'), 'comfort'),
    ]),
    group(t('Night top-up (off-peak)', 'Appoint de nuit (heures creuses)'), [
        chk('night_enabled', t('Top up at night', "Faire l'appoint la nuit"), True),
        txt('night_time', t('At (HH:MM)', 'À (HH:MM)'), '23:00'),
        num('night_below', t('If water below', 'Si eau sous'), 50, 30, 70, C),
        num('night_setpoint', t('Night setpoint', 'Consigne de nuit'), 52, 40, 75, C),
        mode('night_mode', t('Night mode', 'Mode de nuit'), 'green'),
    ]),
    group(t('EDF Tempo', 'EDF Tempo'), [
        chk('tempo_enabled', t('Follow Tempo (Linky meter)', 'Suivre Tempo (compteur Linky)'), True,
            t('Needs the Linky meter chosen in the app settings.', "Nécessite le compteur Linky choisi dans les réglages de l'app.")),
        num('tempo_red_setpoint', t('Red day, peak hours setpoint', 'Consigne jour rouge, heures pleines'), 40, 40, 60, C,
            t('Low setpoint so the heater does not draw from the grid at the red peak price.', "Consigne basse pour ne pas tirer sur le réseau au tarif rouge heures pleines.")),
        num('tempo_red_eve_setpoint', t('Preheat the night before a red day', "Préchauffe la nuit veille d'un jour rouge"), 55, 40, 75, C),
        chk('tempo_red_allow_solar', t('Solar and battery allowed on red days', 'Solaire et batterie autorisés les jours rouges'), True),
        chk('tempo_red_block_boost', t('Refuse boost on red peak hours', 'Refuser le boost en heures pleines rouges'), True),
    ]),
    group(t('Anti-legionella (monthly)', 'Anti-légionellose (mensuelle)'), [
        chk('legio_enabled', t('Monthly anti-legionella cycle', 'Cycle anti-légionellose mensuel'), True),
        num('legio_setpoint', t('Cycle setpoint', 'Consigne du cycle'), 65, 60, 75, C),
        num('legio_done_temp', t('Cycle done at', 'Cycle terminé à'), 64, 55, 75, C),
        mode('legio_mode', t('Cycle mode', 'Mode du cycle'), 'comfort'),
        num('legio_solar_threshold', t('Solar production above', 'Production solaire supérieure à'), 2000, 0, 10000, t('W', 'W')),
        num('legio_solar_duration', t('For at least', 'Pendant au moins'), 15, 1, 120, t('min', 'min')),
        num('legio_solar_days', t('Solar window: until day', "Fenêtre solaire : jusqu'au jour"), 5, 0, 27, t('of month', 'du mois')),
        num('legio_fallback_day', t('Otherwise from day', 'Sinon à partir du jour'), 28, 1, 28, t('of month', 'du mois')),
        txt('legio_fallback_time', t('At (HH:MM, off-peak)', 'À (HH:MM, heures creuses)'), '22:30'),
    ]),
    group(t('Boost', 'Boost'), [
        num('boost_max_minutes', t('Stop boost after', 'Arrêter le boost après'), 60, 0, 480, t('min', 'min'),
            t('Then back to the strategy. 0 = no limit.', 'Puis retour à la stratégie. 0 = sans limite.')),
    ]),
    group(t('General', 'Général'), [
        chk('notifications', t('Timeline notifications', 'Notifications dans la timeline'), True),
        num('poll_interval', t('Cloud polling interval', 'Intervalle de lecture du cloud'), 2, 1, 15, t('min', 'min'),
            t('The Ariston cloud limits the number of requests: keep 2 min or more.', "Le cloud Ariston limite le nombre de requêtes : garder 2 min ou plus.")),
        {'id': 'gateway', 'type': 'label', 'label': t('Gateway', 'Passerelle'), 'value': ''},
        {'id': 'whe_type', 'type': 'label', 'label': t('Model', 'Modèle'), 'value': ''},
        {'id': 'limits', 'type': 'label', 'label': t('Setpoint limits', 'Limites de consigne'), 'value': ''},
    ]),
]

CAPABILITIES = {
    'ariston_mode': {
        'type': 'enum', 'title': t('Mode', 'Mode'), 'getable': True, 'setable': True, 'uiComponent': 'picker',
        'values': [{'id': k, 'title': v} for k, v in MODES], 'icon': '/assets/capabilities/mode.svg',
    },
    'ariston_boost': {
        'type': 'boolean', 'title': t('Boost', 'Boost'), 'getable': True, 'setable': True, 'uiComponent': 'toggle',
        'insights': True, 'insightsTitleTrue': t('Boost on', 'Boost activé'), 'insightsTitleFalse': t('Boost off', 'Boost désactivé'),
        'icon': '/assets/capabilities/boost.svg',
    },
    'ariston_heatpump': {
        'type': 'boolean', 'title': t('Heat pump running', 'Pompe à chaleur en marche'), 'getable': True, 'setable': False,
        'uiComponent': 'sensor', 'insights': True,
        'insightsTitleTrue': t('Heat pump started', 'Pompe à chaleur démarrée'), 'insightsTitleFalse': t('Heat pump stopped', 'Pompe à chaleur arrêtée'),
        'icon': '/assets/capabilities/heatpump.svg',
    },
    'ariston_automation': {
        'type': 'boolean', 'title': t('Automatic strategy', 'Stratégie automatique'), 'getable': True, 'setable': True,
        'uiComponent': 'toggle', 'icon': '/assets/capabilities/auto.svg',
    },
    'ariston_rule': {
        'type': 'string', 'title': t('Active rule', 'Règle active'), 'getable': True, 'setable': False, 'uiComponent': 'sensor',
        'icon': '/assets/capabilities/auto.svg',
    },
    'ariston_legionella': {
        'type': 'string', 'title': t('Last anti-legionella', 'Dernière anti-légionellose'), 'getable': True, 'setable': False,
        'uiComponent': 'sensor', 'icon': '/assets/capabilities/legionella.svg',
    },
    'ariston_energy': {
        'type': 'number', 'title': t('Energy, last day', 'Énergie, dernier jour'), 'units': t('kWh', 'kWh'), 'decimals': 2,
        'getable': True, 'setable': False, 'uiComponent': 'sensor', 'insights': True, 'icon': '/assets/capabilities/energy.svg',
    },
}

FLOW = {
    'triggers': [
        {'id': 'rule_changed', 'title': t('The active rule changed', 'La règle active a changé'),
         'tokens': [{'name': 'rule', 'type': 'string', 'title': t('Rule', 'Règle'), 'example': t('Solar production', 'Production solaire')},
                    {'name': 'setpoint', 'type': 'number', 'title': t('Setpoint', 'Consigne'), 'example': 52}],
         'args': DEVICE},
        {'id': 'mode_changed', 'title': t('The mode changed', 'Le mode a changé'),
         'tokens': [{'name': 'mode', 'type': 'string', 'title': t('Mode', 'Mode'), 'example': 'Green'}], 'args': DEVICE},
        {'id': 'legionella_started', 'title': t('Anti-legionella cycle started', 'Le cycle anti-légionellose a démarré'),
         'tokens': [{'name': 'temperature', 'type': 'number', 'title': t('Water temperature', "Température de l'eau"), 'example': 48}], 'args': DEVICE},
        {'id': 'legionella_done', 'title': t('Anti-legionella cycle done', 'Le cycle anti-légionellose est terminé'),
         'tokens': [{'name': 'temperature', 'type': 'number', 'title': t('Water temperature', "Température de l'eau"), 'example': 64}], 'args': DEVICE},
        {'id': 'boost_stopped', 'title': t('Boost stopped by the app', "Le boost a été arrêté par l'app"),
         'tokens': [{'name': 'reason', 'type': 'string', 'title': t('Reason', 'Raison'), 'example': t('time limit', 'durée maximale')},
                    {'name': 'temperature', 'type': 'number', 'title': t('Water temperature', "Température de l'eau"), 'example': 55}],
         'args': DEVICE},
        {'id': 'cloud_error', 'title': t('The Ariston cloud is unreachable', 'Le cloud Ariston est injoignable'),
         'tokens': [{'name': 'error', 'type': 'string', 'title': t('Error', 'Erreur'), 'example': 'HTTP 503'}], 'args': DEVICE},
    ],
    'conditions': [
        {'id': 'mode_is', 'title': t('Mode !{{is|is not}}', 'Le mode !{{est|n\'est pas}}'),
         'titleFormatted': t('Mode !{{is|is not}} [[mode]]', 'Le mode !{{est|n\'est pas}} [[mode]]'), 'args': DEVICE + [MODE_ARG]},
        {'id': 'boost_on', 'title': t('Boost !{{is|is not}} on', 'Le boost !{{est|n\'est pas}} activé'), 'args': DEVICE},
        {'id': 'heatpump_running', 'title': t('Heat pump !{{is|is not}} running', 'La pompe à chaleur !{{est|n\'est pas}} en marche'), 'args': DEVICE},
        {'id': 'automation_on', 'title': t('Automatic strategy !{{is|is not}} on', 'La stratégie automatique !{{est|n\'est pas}} active'), 'args': DEVICE},
        {'id': 'rule_is', 'title': t('Active rule !{{is|is not}}', 'La règle active !{{est|n\'est pas}}'),
         'titleFormatted': t('Active rule !{{is|is not}} [[rule]]', 'La règle active !{{est|n\'est pas}} [[rule]]'),
         'args': DEVICE + [{'type': 'dropdown', 'name': 'rule', 'title': t('Rule', 'Règle'), 'values': [{'id': k, 'label': v} for k, v in RULES]}]},
        {'id': 'legionella_done_month', 'title': t('Anti-legionella !{{is|is not}} done this month', "L'anti-légionellose !{{est|n'est pas}} faite ce mois-ci"), 'args': DEVICE},
    ],
    'actions': [
        {'id': 'set_mode', 'title': t('Set the mode', 'Régler le mode'), 'titleFormatted': t('Set the mode to [[mode]]', 'Régler le mode sur [[mode]]'),
         'hint': t('Kept until the next daily reset, like a change from the app.', "Conservé jusqu'à la prochaine remise à zéro quotidienne, comme un changement depuis l'app."),
         'args': DEVICE + [MODE_ARG]},
        {'id': 'set_boost', 'title': t('Switch boost', 'Activer ou couper le boost'), 'titleFormatted': t('Switch boost [[state]]', 'Boost : [[state]]'), 'args': DEVICE + [ON_OFF_ARG]},
        {'id': 'set_automation', 'title': t('Switch the automatic strategy', 'Activer ou suspendre la stratégie automatique'),
         'titleFormatted': t('Automatic strategy [[state]]', 'Stratégie automatique : [[state]]'), 'args': DEVICE + [ON_OFF_ARG]},
        {'id': 'start_legionella', 'title': t('Start an anti-legionella cycle now', 'Lancer un cycle anti-légionellose maintenant'), 'args': DEVICE},
        {'id': 'resume_strategy', 'title': t('Cancel the manual change and resume the strategy', 'Annuler le changement manuel et reprendre la stratégie'), 'args': DEVICE},
        {'id': 'refresh', 'title': t('Refresh from the Ariston cloud', 'Actualiser depuis le cloud Ariston'), 'args': DEVICE},
    ],
}

APP = {
    'id': 'com.pepane13.ariston',
    'version': VERSION,
    'compatibility': '>=12.2.0',
    'sdk': 3,
    'platforms': ['local'],
    'name': t('Ariston Nuos', 'Ariston Nuos'),
    'description': t('Control your Ariston Nuos heat pump water heater with solar, battery and EDF Tempo rules',
                     'Pilotez votre chauffe-eau thermodynamique Ariston Nuos selon le solaire, la batterie et EDF Tempo'),
    'category': ['climate'],
    'permissions': ['homey:manager:api'],
    'images': {'small': '/assets/images/small.png', 'large': '/assets/images/large.png', 'xlarge': '/assets/images/xlarge.png'},
    'author': {'name': 'Stéphane Renaudet', 'email': 'stephane.renaudet@gmail.com'},
    'brandColor': '#0F6FB5',
    'support': 'https://github.com/Pepane13/homey-ariston-nuos/issues',
    'source': 'https://github.com/Pepane13/homey-ariston-nuos',
    'api': {
        'getSources': {'method': 'GET', 'path': '/sources'},
        'setSources': {'method': 'PUT', 'path': '/sources'},
    },
    'capabilities': CAPABILITIES,
    'drivers': [{
        'id': 'nuos',
        'name': t('Ariston Nuos', 'Ariston Nuos'),
        'class': 'waterheater',
        'capabilities': ['onoff', 'measure_temperature', 'target_temperature', 'ariston_mode', 'ariston_boost',
                         'ariston_heatpump', 'ariston_automation', 'ariston_rule', 'ariston_legionella',
                         'ariston_energy.hp', 'ariston_energy.resistor'],
        'capabilitiesOptions': {
            'target_temperature': {'min': 40, 'max': 75, 'step': 1, 'decimals': 0},
            'measure_temperature': {'title': t('Water temperature', "Température de l'eau")},
            'onoff': {'title': t('Water heater on', 'Chauffe-eau allumé')},
            'ariston_energy.hp': {'title': t('Heat pump energy, last day', 'Énergie PAC, dernier jour')},
            'ariston_energy.resistor': {'title': t('Resistor energy, last day', 'Énergie résistance, dernier jour')},
        },
        'platforms': ['local'],
        'connectivity': ['cloud'],
        'images': {'small': '/drivers/nuos/assets/images/small.png', 'large': '/drivers/nuos/assets/images/large.png',
                   'xlarge': '/drivers/nuos/assets/images/xlarge.png'},
        'icon': '/drivers/nuos/assets/icon.svg',
        'pair': [
            {'id': 'login_credentials', 'template': 'login_credentials',
             'options': {'title': t('Ariston NET account', 'Compte Ariston NET'),
                         'usernameLabel': t('E-mail', 'E-mail'), 'usernamePlaceholder': 'name@example.com',
                         'passwordLabel': t('Password', 'Mot de passe'), 'passwordPlaceholder': ''}},
            {'id': 'list_devices', 'template': 'list_devices', 'navigation': {'next': 'add_devices'}},
            {'id': 'add_devices', 'template': 'add_devices'},
        ],
        'repair': [
            {'id': 'login_credentials', 'template': 'login_credentials',
             'options': {'title': t('Ariston NET account', 'Compte Ariston NET'),
                         'usernameLabel': t('E-mail', 'E-mail'), 'passwordLabel': t('Password', 'Mot de passe')}},
        ],
        'settings': SETTINGS,
    }],
    'flow': FLOW,
}

with open(os.path.join(ROOT, 'app.json'), 'w', encoding='utf-8') as f:
    json.dump(APP, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('app.json written,', VERSION)
