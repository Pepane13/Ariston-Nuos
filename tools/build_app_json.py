#!/usr/bin/env python3
"""Generates com.pepane13.ariston/app.json (kept as a script so the long manifest stays consistent)."""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'com.pepane13.ariston')
VERSION = '2.0.1'


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

DEVICE = [{'type': 'device', 'name': 'device', 'filter': 'driver_id=nuos'}]
ON_OFF_ARG = {'type': 'dropdown', 'name': 'state', 'title': t('State', 'État'),
              'values': [{'id': 'on', 'label': t('On', 'Activé')}, {'id': 'off', 'label': t('Off', 'Désactivé')}]}


def num(id_, label, value, min_, max_, units, hint=None, step=1):
    s = {'id': id_, 'type': 'number', 'label': label, 'value': value, 'attr': {'min': min_, 'max': max_, 'step': step}, 'units': units}
    if hint:
        s['hint'] = hint
    return s


SETTINGS = [
    num('poll_interval', t('Cloud polling interval', 'Intervalle de lecture du cloud'), 2, 1, 15, t('min', 'min'),
        t('The Ariston cloud limits the number of requests: keep 2 min or more.', "Le cloud Ariston limite le nombre de requêtes : garder 2 min ou plus.")),
    {'id': 'gateway', 'type': 'label', 'label': t('Gateway', 'Passerelle'), 'value': ''},
    {'id': 'whe_type', 'type': 'label', 'label': t('Model', 'Modèle'), 'value': ''},
    {'id': 'limits', 'type': 'label', 'label': t('Setpoint limits', 'Limites de consigne'), 'value': ''},
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
    'ariston_energy': {
        'type': 'number', 'title': t('Energy, last day', 'Énergie, dernier jour'), 'units': t('kWh', 'kWh'), 'decimals': 2,
        'getable': True, 'setable': False, 'uiComponent': 'sensor', 'insights': True, 'icon': '/assets/capabilities/energy.svg',
    },
    # Capabilities of the 1.0.x automatic strategy. No driver uses them any more, but Homey can only remove
    # a capability from an existing device while its definition is still in the app: keep them defined so
    # device.js can drop them from devices paired with 1.0.x.
    'ariston_automation': {
        'type': 'boolean', 'title': t('Automatic strategy', 'Stratégie automatique'), 'getable': True, 'setable': True,
        'uiComponent': 'toggle', 'icon': '/assets/capabilities/auto.svg',
    },
    'ariston_rule': {
        'type': 'string', 'title': t('Active rule', 'Règle active'), 'getable': True, 'setable': False,
        'uiComponent': 'sensor', 'icon': '/assets/capabilities/auto.svg',
    },
    'ariston_legionella': {
        'type': 'string', 'title': t('Last anti-legionella', 'Dernière anti-légionellose'), 'getable': True, 'setable': False,
        'uiComponent': 'sensor', 'icon': '/assets/capabilities/legionella.svg',
    },
}

FLOW = {
    'triggers': [
        {'id': 'mode_changed', 'title': t('The mode changed', 'Le mode a changé'),
         'tokens': [{'name': 'mode', 'type': 'string', 'title': t('Mode', 'Mode'), 'example': 'Green'}], 'args': DEVICE},
        {'id': 'cloud_error', 'title': t('The Ariston cloud is unreachable', 'Le cloud Ariston est injoignable'),
         'tokens': [{'name': 'error', 'type': 'string', 'title': t('Error', 'Erreur'), 'example': 'HTTP 503'}], 'args': DEVICE},
    ],
    'conditions': [
        {'id': 'mode_is', 'title': t('Mode !{{is|is not}}', 'Le mode !{{est|n\'est pas}}'),
         'titleFormatted': t('Mode !{{is|is not}} [[mode]]', 'Le mode !{{est|n\'est pas}} [[mode]]'), 'args': DEVICE + [MODE_ARG]},
        {'id': 'boost_on', 'title': t('Boost !{{is|is not}} on', 'Le boost !{{est|n\'est pas}} activé'), 'args': DEVICE},
        {'id': 'heatpump_running', 'title': t('Heat pump !{{is|is not}} running', 'La pompe à chaleur !{{est|n\'est pas}} en marche'), 'args': DEVICE},
    ],
    'actions': [
        {'id': 'set_mode', 'title': t('Set the mode', 'Régler le mode'), 'titleFormatted': t('Set the mode to [[mode]]', 'Régler le mode sur [[mode]]'),
         'args': DEVICE + [MODE_ARG]},
        {'id': 'set_boost', 'title': t('Switch boost', 'Activer ou couper le boost'), 'titleFormatted': t('Switch boost [[state]]', 'Boost : [[state]]'), 'args': DEVICE + [ON_OFF_ARG]},
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
    'description': t('Control your Ariston Nuos heat pump water heater from Homey and your Flows',
                     'Pilotez votre chauffe-eau thermodynamique Ariston Nuos depuis Homey et vos Flows'),
    'category': ['climate'],
    'permissions': [],
    'images': {'small': '/assets/images/small.png', 'large': '/assets/images/large.png', 'xlarge': '/assets/images/xlarge.png'},
    'author': {'name': 'Stéphane Renaudet', 'email': 'stephane.renaudet@gmail.com'},
    'brandColor': '#0F6FB5',
    'support': 'https://github.com/Pepane13/Ariston-Nuos/issues',
    'source': 'https://github.com/Pepane13/Ariston-Nuos',
    'capabilities': CAPABILITIES,
    'drivers': [{
        'id': 'nuos',
        'name': t('Ariston Nuos', 'Ariston Nuos'),
        'class': 'waterheater',
        'capabilities': ['onoff', 'measure_temperature', 'target_temperature', 'ariston_mode', 'ariston_boost',
                         'ariston_heatpump', 'ariston_energy.hp', 'ariston_energy.resistor'],
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
