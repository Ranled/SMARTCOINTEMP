<?php
// Display-only settings. No router, payment, or coin-slot integration.
return [
    'name' => 'KITIFI-1',
    'demo_mac' => '66:78:94:C8:9D:C6',
    'demo_ip' => '10.0.4.142',
    'rates' => [
        ['pesos' => 1,  'minutes' => 5,   'label' => '5 minutes'],
        ['pesos' => 5,  'minutes' => 30,  'label' => '30 minutes'],
        ['pesos' => 10, 'minutes' => 60,  'label' => '1 hour'],
        ['pesos' => 20, 'minutes' => 180, 'label' => '3 hours'],
    ],
    'vouchers' => ['PISO30' => 30, 'WIFI60' => 60],
];
