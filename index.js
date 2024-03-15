require("dotenv").config({ path: "./dotenv.env" });
const express = require("express");
const landing = require('./landingTemplate');
const { publishToCentral } = require('stremio-addon-sdk')
const app = express();
const fs = require("fs");
var subsrt = require("subtitle-converter");
const iconv = require("iconv-lite");
const unzipper = require("unzipper");
const axios = require('axios')
// const subtitlePageFinder = require("./lib/subtitlePageFinder");
const subtitlePageFinder = require("./scraper");
const config = require('./config');
const MANIFEST = require('./manifest');
//const { HttpProxyAgent, HttpsProxyAgent } = require("hpagent");
const NodeCache = require("node-cache");
const isItDownForMe = require('./addonStatus');
const rateLimit = require('express-rate-limit')
const header = require("./header");
const path = require("path");
const crypto = require("crypto");
const https = require("https");



const allowLegacyRenegotiationforNodeJsOptions = {
  httpsAgent: new https.Agent({
    // for self signed you could also add
    // rejectUnauthorized: false,
    // allow legacy server
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  }),
};


const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

//app.set('trust proxy', '127.0.0.1');

const myCache = new NodeCache({ stdTTL: 15 * 60, checkperiod: 120 });

// const agentConfig = {
//   keepAlive: false,
//   keepAliveMsecs: 2000,
//   maxSockets: 256,
//   maxFreeSockets: 256,
// };

// axios.defaults.httpAgent = new HttpProxyAgent(agentConfig);
// axios.defaults.httpsAgent = new HttpsProxyAgent(agentConfig);

const CACHE_MAX_AGE = 4 * 60 * 60; // 4 hours in seconds
const STALE_REVALIDATE_AGE = 4 * 60 * 60; // 4 hours
const STALE_ERROR_AGE = 7 * 24 * 60 * 60; // 7 days

var respond = function (res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  res.send(data);
};

app.get('/', function (req, res) {
  res.set('Content-Type', 'text/html');
  res.send(landing(MANIFEST));
});

app.get("/:userConf?/configure", function (req, res) {
  if (req.params.userConf !== "addon") {
    res.redirect("/addon/configure")
  } else {
    res.set('Content-Type', 'text/html');
    const newManifest = { ...MANIFEST };
    res.send(landing(newManifest));
  }
});

app.get('/manifest.json', function (req, res) {
  const newManifest = { ...MANIFEST };
  // newManifest.behaviorHints.configurationRequired = false;
  newManifest.behaviorHints.configurationRequired = true;
  respond(res, newManifest);
});

app.get('/:userConf/manifest.json', function (req, res) {
  const newManifest = { ...MANIFEST };
  if (!((req || {}).params || {}).userConf) {
    newManifest.behaviorHints.configurationRequired = true;
    respond(res, newManifest);
  } else {
    newManifest.behaviorHints.configurationRequired = false;
    respond(res, newManifest);
  }
});




function getsub(subFilePath) {
  try {
    const buffer = fs.readFileSync(subFilePath);
    const decodedFileContent = iconv.decode(buffer, 'ISO-8859-9')
    var foundext = path.extname(subFilePath)

    if (foundext != ".srt") {

      const outputExtension = '.srt'
      const options = {
        removeTextFormatting: true,
      };
      const { subtitle } = subsrt.convert(decodedFileContent, outputExtension, options)
      return { text: subtitle, ext: foundext };

    } else {
      return { text: decodedFileContent, ext: foundext };
    }
  } catch (error) {
    if (error) return console.log(error);
  }

}


function CheckFolderAndFiles() {
  const folderPath = './subs/';
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
  }

  const files = fs.readdirSync(folderPath);

  if (files.length > 100) {
    files.forEach((file) => {
      const filePath = path.join(folderPath, file);
      const fileStats = fs.statSync(filePath);

      if (fileStats.isFile()) {
        fs.unlinkSync(filePath);
      } else if (fileStats.isDirectory()) {
        // Dizin içinde dosya varsa onları da silmek için
        fs.rmdirSync(filePath, { recursive: true });
      }
    });
  }
}


function SeriesAndMoviesCheck(altid, episode) {
  var returnValue = "";
  var files = fs.readdirSync(`./subs/${altid}`);

  if (!String(files[0]).includes(".")) {
    files = fs.readdirSync(`./subs/${altid}/${files[0]}`);
  }
  for (const value of files) {

    //MOVİE 
    if (episode == 0) {
      returnValue = `./subs/${altid}/${value}`;
      break;
    }
    //SERİES
    else if (value.includes("E" + episode || "e" + episode)) {
      returnValue = `./subs/${altid}/${value}`;
      break;

    } else if (value.includes("B" + episode || "b" + episode)) {
      returnValue = `./subs/${altid}/${value}`;
      break;
    }
    else if (value.includes("_" + episode + "_")) {
      returnValue = `./subs/${altid}/${value}`;
      break;

    }
    else if (value.includes("x" + episode || "X" + episode)) {
      returnValue = `./subs/${altid}/${value}`;
      break;

    }
    else if (value.includes(episode)) {
      returnValue = `./subs/${altid}/${value}`;
      break;
    }
    else if (files.length == 1) {
      returnValue = `./subs/${altid}/${value}`;
      break;
    }
  }

  return returnValue;
}

app.get('/download/:idid\-:sidid\-:altid\-:episode', async function (req, res) {
  try {
    var subFilePath = "";
    var episode = req.params.episode;


    if (req.params.episode == 0) {
      episode = 0;
    } else if (req.params.episode < 10) {
      episode = "0" + req.params.episode;
    }


    CheckFolderAndFiles();
    res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate:${STALE_REVALIDATE_AGE}, stale-if-error:${STALE_ERROR_AGE}`);
    if (fs.existsSync(path.join(__dirname, "subs", req.params.altid))) {
      subFilePath = SeriesAndMoviesCheck(req.params.altid, episode);

      var textt = getsub(subFilePath);

      //delete zip file
      if (fs.existsSync(`./subs/${req.params.altid}.zip`)) {
        fs.rmSync(`./subs/${req.params.altid}.zip`);
      }

      if (textt && typeof (textt.text) !== "undefined") {
        return res.send(textt.text)
      }
    } else {
      await axios({ ...allowLegacyRenegotiationforNodeJsOptions, url: process.env.PROXY_URL + '/ind', method: "POST", headers: header, data: `idid=${req.params.idid}&altid=${req.params.altid}&sidid=${req.params.sidid}`, responseType: 'arraybuffer', responseEncoding: 'binary' }).then((response) => {
        if (response && response.status === 200 && response.statusText === 'OK') {
          fs.writeFileSync(`./subs/${req.params.altid}.zip`, response.data, { encoding: 'binary' })
          //extract zip
          fs.createReadStream(`./subs/${req.params.altid}.zip`).pipe(unzipper.Extract({ path: `./subs/${req.params.altid}`})).on('error', (err) => console.error('Hata:', err)).on("finish", async () => {
            subFilePath = SeriesAndMoviesCheck(req.params.altid, episode);

            var textt = getsub(subFilePath);

            //delete zip file
            if (fs.existsSync(`./subs/${req.params.altid}.zip`)) {
              fs.rmSync(`./subs/${req.params.altid}.zip`);
            }

            if (textt && typeof (textt.text) !== "undefined") {
              return res.send(textt.text)
            }
          });
        }
      }).catch((error) => {
        console.log(error)
        return res.send("Couldn't get the subtitle.")
      })
    }




  } catch (err) {
    console.log(err)
    return res.send("Couldn't get the subtitle.")
  }

});

app.get('/:userConf?/subtitles/:type/:imdbId/:query?.json', async function (req, res) {
  try {
    let { type, imdbId, query } = req.params
    let videoId = imdbId.split(":")[0]
    let season = Number(imdbId.split(":")[1])
    let episode = Number(imdbId.split(":")[2])

    if (myCache.has(req.params.imdbId)) {
      respond(res, myCache.get(req.params.imdbId));
    } else {
      const subtitles = await subtitlePageFinder(videoId, type, season, episode);
      if (subtitles.length > 0) {
        myCache.set(req.params.imdbId, { subtitles: subtitles, cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE }, 15 * 60) // 15 mins
        respond(res, { subtitles: subtitles, cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE });
      } else {
        myCache.set(req.params.imdbId, { subtitles: subtitles }, 2 * 60) // 2 mins
        respond(res, { subtitles: subtitles });
      }
    }

  } catch (err) {
    console.log(err);
    respond(res, { "subtitles": [] });
  }
})

app.get('/cache-status/:devpass?/:query?/:key?', function (req, res) {
  // let { devpass, query, key } = req.params
  // const devKey = process.env.DEV_KEY;
  // try {
  //   if (devKey == devpass) {
  //     if (query == "keys") {
  //       res.send(myCache.keys())
  //     } else if (query == "flushAll") {
  //       res.send(myCache.flushAll())
  //     } else if (query == "flushStats") {
  //       res.send(myCache.flushStats())
  //     } else if (query == "get") {
  //       if (key) {
  //         res.send(myCache.get(key))
  //       } else {
  //         res.send("You forgot to send the key!")
  //       }
  //     } else if (query == "getStats") {
  //       res.send(myCache.getStats())
  //     } else {
  //       res.send("Missing or wrong parameter.")
  //     }
  //   } else {
  //     return res.send("You shouldn't be here.")
  //   }
  // } catch (err) {
  //   console.log(err)
  //   return res.send("Error ocurred.")
  // }

  return res.send("You shouldn't be here.")
});

app.get('/app-status/:devpass?', async function (req, res) {
  // let { devpass } = req.params
  // const devKey = process.env.DEV_KEY;
  // if (devpass == devKey) {
  //   let proxyStatus, websiteStatus
  //   try {
  //     const responseProxy = await axios.get("https://api.myip.com/");
  //     if (responseProxy.data.cc.trim() === "TR") {
  //       proxyStatus = "OK!"
  //     } else {
  //       proxyStatus = "FAIL!"
  //     }
  //   } catch (error) {
  //     proxyStatus = "SERVER DOWN!"
  //   }

  //   try {
  //     websiteStatus = await isItDownForMe()
  //     if (websiteStatus.status == 1 && websiteStatus.result.status == "Site Online") {
  //       websiteStatus = "OK!"
  //     } else {
  //       websiteStatus = "FAIL!"
  //     }
  //   } catch (error) {
  //     websiteStatus = "WEBSITE DOWN!"
  //   }
  //   return res.send(`Proxy Status: ${proxyStatus}\nWebsite Status: ${websiteStatus} `)
  // } else {
  return res.send("You shouldn't be here.")
  // }
});

app.get('/ip', function (req, res) {
  res.send(req.ip)
});

app.get('*', function (req, res) {
  res.redirect("/")
});

if (module.parent) {
  module.exports = app;
} else {
  app.listen(config.port, function () {
    console.log(config)
  });
}
//publish to stremio store
//publishToCentral(process.env.URL + "/manifest.json");
