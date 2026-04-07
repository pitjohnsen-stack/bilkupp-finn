'use strict';

const REGIONS = {
  nordland:   '0.20018',
  troms:      '0.20019',
  finnmark:   '0.20020',
  trondelag:  '0.20016',
  vestland:   '0.22046',
  rogaland:   '0.20012',
  moreroms:   '0.20015',
  agder:      '0.22042',
  oslo:       '0.20061',
  akershus:   '0.20003',
  ostfold:    '0.20002',
  buskerud:   '0.20007',
  innlandet:  '0.22034',
  vestfold:   '0.20008',
  telemark:   '0.20009',
  norge:      null,
};

const TRANSPORT_COSTS_TO_NORDLAND = {
  oslo:       12000,
  viken:      12000,
  vestfold:   13000,
  telemark:   13000,
  innlandet:  11000,
  trondelag:   7000,
  vestland:   14000,
  rogaland:   15000,
  moreroms:    9000,
  agder:      15000,
  troms:       4000,
};

module.exports = { REGIONS, TRANSPORT_COSTS_TO_NORDLAND };
