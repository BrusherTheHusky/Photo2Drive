var lock = LockService.getUserLock();
var exportFolder = "";
var searchRange = "";
var userLog = [];
var nextPageToken = "";
var execution = 0;

function syncLog(execution, entry) {
  Logger.log(entry);
  userLog = JSON.parse(PropertiesService.getUserProperties().getProperty('userLog'));
  !userLog ? userLog = [] : "";
  userLog.push('('+new Date().toISOString()+') ('+parseInt(execution)+') '+entry.substring(0, 50));
  while (userLog.length > 100) {
    userLog.splice(0,1);
  };
  PropertiesService.getUserProperties().setProperty('userLog', JSON.stringify(userLog));
};

function getUserProperties() {
  exportFolder = PropertiesService.getUserProperties().getProperty('exportFolder');
  searchRange = PropertiesService.getUserProperties().getProperty('searchRange');
  execution = PropertiesService.getUserProperties().getProperty('execution');
  isNaN(execution) ? execution = 0 : execution = execution;
  userLog = JSON.parse(PropertiesService.getUserProperties().getProperty('userLog'));
};

function doGet(e) {
  Logger.log(Session.getActiveUser().getEmail());

  if (e.parameter.reset) {
    PropertiesService.getUserProperties().deleteAllProperties();
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      ScriptApp.deleteTrigger(triggers[i]);
    };
  };

  if (e.parameter.clearLog) {
    PropertiesService.getUserProperties().deleteProperty('userLog');
  }

  if (e.parameter.exportFolder) {
    exportFolder = e.parameter.exportFolder;
    PropertiesService.getUserProperties().setProperty('exportFolder', exportFolder);
  };

  if (e.parameter.searchRange) {
    searchRange = e.parameter.searchRange;
    PropertiesService.getUserProperties().setProperty('searchRange', searchRange);
  };
  
  if (e.parameter.frequency) {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      ScriptApp.deleteTrigger(triggers[i]);
    };
    ScriptApp.newTrigger('startSync').timeBased().everyMinutes(e.parameter.frequency).create();
  };

  getUserProperties();
  var triggers = ScriptApp.getProjectTriggers();
  
  Logger.log("exportFolder:"+exportFolder);
  Logger.log("searchRange:"+searchRange);
  for (var i = 0; i < triggers.length; i++) {
    Logger.log("Trigger "+i+": "+triggers[i].getUniqueId());
  };

  var webOut = HtmlService.createHtmlOutput();
  if (!exportFolder || !searchRange) {
    webOut.append("Required variables undefined, script will not run.<br />");
    webOut.append("<br />");
  };
  webOut.append("<button type='button' onclick='google.script.run.startSync();'>Run sync!</button><br />");
  webOut.append("<br />");
  webOut.append("user = "+Session.getActiveUser().getEmail()+"<br />");
  webOut.append("<br />");
  webOut.append("exportFolder = "+exportFolder+"<br />");
  webOut.append("<br />");
  webOut.append("searchRange = "+searchRange+"<br />");
  webOut.append("<br />");
  webOut.append("execution = "+execution+"<br />");
  webOut.append("<br />");
  webOut.append("frequency = <br />");
  for (var i = 0; i < triggers.length; i++) {
    webOut.append("&nbsp;&nbsp;&nbsp;&nbsp;"+i+". "+triggers[i].getUniqueId()+"<br />");
  };
  webOut.append("<br />");
  webOut.append("Log (last 100) = <br />&nbsp;&nbsp;&nbsp;&nbsp;");
  !userLog ? webOut.append("No logs to display") : webOut.append(userLog.join("<br />&nbsp;&nbsp;&nbsp;&nbsp;"));
  return webOut;
};

function startSync() {
  getUserProperties();
  execution = parseInt(execution) + 1
  PropertiesService.getUserProperties().setProperty('execution', execution)
  syncLog(execution, "Sync started");

  var scriptTimeout = new Date();
  scriptTimeout.setMinutes(scriptTimeout.getMinutes() + 20);

  getUserProperties();
  if (!exportFolder || !searchRange) {
    syncLog(execution, "Required variables undefined, exiting");
    return; 
  }

  var startDate = new Date();
  startDate.setDate(startDate.getDate() - searchRange);
  var endDate = new Date();

  while (nextPageToken !== undefined){
    var photoGetOpts = {
      'muteHttpExceptions' : true,
      'method' : 'post',
      'contentType' : 'application/json',
      'headers' : {
        'Authorization' : "Bearer "+ScriptApp.getOAuthToken()  
      },
      'payload' : '{\
        "filters": {\
          "dateFilter": {\
            "ranges": [\
              {\
                "startDate": {\
                  "day": '+startDate.getDate()+',\
                  "month": '+(startDate.getMonth()+1)+',\
                  "year": '+startDate.getFullYear()+'\
                },\
                "endDate": {\
                  "day": '+endDate.getDate()+',\
                  "month": '+(endDate.getMonth()+1)+',\
                  "year": '+endDate.getFullYear()+'\
                }\
              }\
            ]\
          }\
        },\
        "orderBy": "MediaMetadata.creation_time",\
        "pageSize": 50,\
        "pageToken": "'+nextPageToken+'"\
      }'
    };
    var photoGet = JSON.parse(UrlFetchApp.fetch("https://photoslibrary.googleapis.com/v1/mediaItems:search", photoGetOpts).getContentText());

    if (photoGet["mediaItems"]) {
      for (var i = 0; i < photoGet.mediaItems.length; i++) {
        if (new Date() > scriptTimeout) {
          syncLog(execution, "Timeout reached, exiting");
          return;
        }

        if (!lock.tryLock(10)) {
          syncLog(execution, "Could not get lock, exiting");
          return;
        };

        if (Drive.Files.list({
          "corpora": "allDrives",
          "includeTeamDriveItems": true,
          "q": "'"+exportFolder+"' in parents and trashed = false and properties has {key='photoId' and value='"+photoGet.mediaItems[i].id+"' and visibility='PUBLIC'}",
          "supportsTeamDrives": true
        }).items.length == 0) {
          if (photoGet.mediaItems[i].mimeType.match("^video/")) {
            photoDownloadUrl = photoGet.mediaItems[i].baseUrl+"=dv";
          } else {
            photoDownloadUrl = photoGet.mediaItems[i].baseUrl+"=d";
          };
          var file = DriveApp.getFolderById(exportFolder).createFile(UrlFetchApp.fetch(photoDownloadUrl).getBlob()).setName(photoGet.mediaItems[i].filename).getId();
          var property = {
            key: 'photoId',
            value: photoGet.mediaItems[i].id,
            visibility: 'PUBLIC'
          };
          Drive.Properties.insert(property, file);

          syncLog(execution, "Uploaded: "+photoGet.mediaItems[i].filename);
        };
        lock.releaseLock();
      };
    }

    nextPageToken = photoGet.nextPageToken;
  };
  syncLog(execution, "Sync completed");
};
