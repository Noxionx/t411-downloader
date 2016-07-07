var Q = require('q');
var fs = require('fs');

MAX_TORRENTS = 10;

TRANSMISSION_USER = 'username';
TRANSMISSION_PASSWORD = 'password';

T411_USER = 'username';
T411_PASSWORD = 'password';

function T411Downloader(username, password){
    var T411Manager = require('t411-manager');
    this.t411client = new T411Manager({
            username : username,
            password : password
        });

    var Transmission = require('transmission');
    this.transmission = new Transmission({
        host: 'localhost',
        port: 9091,
        username: TRANSMISSION_USER,
        password: TRANSMISSION_PASSWORD
    });
}

function _getTorrentRate(torrent){
    if(torrent.size<102400000 || torrent.size>10240000000) return 0;
    var rate = torrent['leechers'];
    var weight = 1 / Math.log(torrent['seeders']+2);
    rate = (rate * weight) - torrent['times_completed'];
    return torrent['times_completed']<10? rate : 0;
}

T411Downloader.prototype.getRatedTorrents = function(){
    return this.t411client.getTorrents({
        limit: 5000
    }).then(function(torrents){
        torrents.forEach(function(torrent){
            torrent.rate = _getTorrentRate(torrent);
        });

        torrents.sort(function(a, b){
            return b.rate - a.rate;
        });

        var i = 0;
        do{
            i++;
        }while(i<torrents.length && torrents[i].rate>15);
        return torrents.slice(0, i);
    });
};

T411Downloader.prototype.getTransmissionTorrents = function(){
    var deferred = Q.defer();
    this.transmission.get(function(err, res){
        if(err){
            deferred.reject(err);
        }
        else{
            deferred.resolve(res['torrents']);
        }
    });
    return deferred.promise;
};

T411Downloader.prototype.clean = function(){
    var self = this;

    return Q().then(function(){
        return self.getTransmissionTorrents();
    }).then(function(torrents){
        var ids = [];
        torrents.forEach(function(torrent){
            if(torrent['uploadRatio']>2 || (torrent['addedDate'] + (72*60*60*1000))>Date.now()){
                ids.push(torrent.id);
            }
        });
        self.transmission.remove(ids, true, function(err, res){
            if(err) throw err;
            else {
                console.log('cleaned', ids.length, 'torrents');
                return res;
            }
        })
    });
};

T411Downloader.prototype.add = function(torrent){
    var self = this;

    var deferred = Q.defer();

    self.getTransmissionTorrents().then(function(torrents){
        if(torrents.length<MAX_TORRENTS){
            var exists = false;
            torrents.forEach(function(t){
                if(t['creator'].indexOf(torrent['owner']) && t['totalSize']==torrent.size){
                    exists = true;
                }
            });
            if(!exists){
                var torrentName = torrent.id+'.torrent';
                self.t411client.saveTorrent(torrent.id, torrentName).then(function(){
                    self.transmission.addFile(torrentName, function(err1){
                        fs.unlink(torrentName, function(err2){
                            if(err1 || err2) deferred.reject(err1? 'Add error : '+err1:'' + err2? err2:'');
                            else deferred.resolve();
                        });
                    });
                });
            }
            else{
                deferred.resolve();
            }
        }
        else{
            deferred.resolve();
        }
    });

    return deferred.promise;
};


function _refreshTorrents(){
    var t411Downloader = new T411Downloader(T411_USER, T411_PASSWORD);

    return Q().then(function(){
        return t411Downloader.clean();
    }).then(function(){
        return t411Downloader.getRatedTorrents()
    }).then(function(torrents){
        var promises = [];
        t411Downloader.getTransmissionTorrents().then(function(tTorrents){
            if(tTorrents.length<MAX_TORRENTS){
                var index = (MAX_TORRENTS-tTorrents.length);
                torrents = index>0? torrents.slice(0, index):[];
                torrents.forEach(function(torrent){
                    promises.push(t411Downloader.add(torrent))
                });
            }
        });
        return Q.all(promises);
    }).catch(function(e){
        console.log(e);
    });
}

_refreshTorrents();
