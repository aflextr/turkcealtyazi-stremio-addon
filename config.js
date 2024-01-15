var env = "local";
const getProxy = require('./getProxy')
require("dotenv").config({path:"./dotenv.env"});
var config = {
    turkceAltyaziURL: 'turkcealtyazi-dotorg.gateway.web.tr',
  
}

switch (env) {
    //Public server build.
    case 'beamup':
		config.port = process.env.PORT
        config.local = "https://5a0d1888fa64-turkcealtyaziorg.baby-beamup.club"
        break;

    //Local sever build.
    case 'local':
		config.port = process.env.PORT
        config.local = process.env.URL
        break;
}

module.exports = config;