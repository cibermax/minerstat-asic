/*
	DEPENDENCIES
*/
const path = require('path');
var colors = require('colors');
const url = require('url');
var fs = require('fs');
var node_ssh = require('node-ssh');
var request = require('request');
const nets = require('net');
var ssh2 = new node_ssh();
var await = require('await');
var needle = require('needle');
var async = require('neo-async');
const jetpack = require('fs-jetpack');
const electron = require('electron')
const app = electron.app
var fullpath = app.getPath("appData");

"use strict";

/*
	MAIN FUNCTIONS
*/
function getDateTime() {
    var date = new Date();
    var hour = date.getHours();
    var min = date.getMinutes();
    var sec = date.getSeconds();
    hour = (hour < 10 ? "0" : "") + hour;
    min = (min < 10 ? "0" : "") + min;
    sec = (sec < 10 ? "0" : "") + sec;
    return hour + ":" + min + ":" + sec;
}

function updateStatus(connection, status) {

    var o = {} // empty Object
    o["status"] = [];

    var data = {
        internet: connection,
        status: status
    };

    o["status"].push(data);
    //fs.writeFile("www/user.json", JSON.stringify(o), function(err) {
    //    if (err) {
    //        return console.log(err);
    //    }
    //});
    jetpack.write(fullpath + '/user.json', JSON.stringify(o));

}


/*
	STAT PROCESSING
*/

module.exports = {
    workersRefresh: function() {

        // Starts from here
        var o = {} // empty Object

        console.log("-*-*- STARTING NEW SYNC ROUND -*-*-");

        require('dns').resolve('api.minerstat.com', function(err) {
            if (err) {
                console.log("Round skipped, connection problems.");

                updateStatus(false, "Waiting for connection..");

                // Start New Round after 20 sec idle
                setTimeout(function() {
                    var main = require('./main');
                    main.sync();
                }, 25000);
            } else {
                start(true);
            }
        });


        function start(connection) {

            if (connection === true) {

                // GET LOGIN INFORMATION
                if (!fs.existsSync(fullpath + "/login.json")) {

                    console.log("Round skipped, no user details.");
                    setTimeout(function() {
                        var main = require('./main');
                        main.sync();
                    }, 1000);

                } else {

                    var myMiner = {
                        sync: 'false'
                    };
                    var json_login, login_token, login_group;

                    const data = jetpack.read(fullpath + '/login.json');
                    json_login = data.toString();
                    console.log(json_login);

                    var proc = JSON.parse(json_login);

                    login_token = proc["login"][0]["token"];
                    login_group = proc["login"][0]["group"];

                    loop();



                    function loop() {

                        request.get({
                                url: 'https://api.minerstat.com/api/api_ant.php?tokener=' + login_token + '&filter=asic&group=' + login_group,
                                form: {
                                    node: "asic"
                                }
                            },
                            function(error, response, body) {

                                var json_string = response.body;

                                if (json_string.indexOf("list") > -1) {

                                    var obj = JSON.parse(json_string);

                                    var total_worker = obj["global"]["total"];
                                    var total_count = 0;
                                    var sync_done = false;

                                    // SAVE .JSON for Front-end
                                    jetpack.write(fullpath + '/api.json', json_string);


                                    // empty list Array, push() values into
                                    o["list"] = [];

                                    updateStatus(connection, "Sync in progress..");

                                    for (var id in obj.list) {

                                        var worker = obj.list[id];

                                        // empty Array, push() values into
                                        o[worker] = [];

                                        var accesskey = obj[worker].token;
                                        var ip_address = obj[worker].ip;
                                        var type = obj[worker].type;
                                        var login = obj[worker].ssh_login;
                                        var passw = obj[worker].ssh_pass;

                                        console.log("[" + getDateTime() + "] " + "Async Fetch: " + type + " worker: " + worker + " at " + ip_address + " with " + login + "/" + passw);

                                        // Starting Process data's
                                        var command, folder, sshinfo, sshres1, sshres2;
                                        var tcpinfo = "";

                                        // Fetch TCP

                                        async function callbackssh(worker, tcp, ssh) {

                                            // Push values
                                            var data = {
                                                tcp_response: tcp,
                                                ssh_response: ssh
                                            };

                                            o[worker].push(data);
                                            o["list"].push(worker);

                                            total_count++;
                                            if (total_worker == total_count) {
                                                sync_done = true;
                                            }


                                        }

                                        //////////////////////////////////////////////////////////////

                                        async function callbacktcp(worker, tcp, host) {

                                            var command, folder, ssh = "";

                                            if (tcp == "timeout") {

                                                console.log(worker + " - SSH Skipped - Reason: Worker inactive");

                                                total_count++;
                                                if (total_worker == total_count) {
                                                    sync_done = true;
                                                }

                                            } else {

                                                if (tcp.indexOf("cgminer") > -1) {
                                                    command = "cgminer-api stats; cgminer-api pools;";
                                                    folder = "/root";
                                                }

                                                if (tcp.indexOf("bmminer") > -1) {
                                                    command = "bmminer-api stats; bmminer-api pools;";
                                                    folder = "/root";
                                                }


                                                ssh = await getSSH(host, login, passw, folder, command, worker, tcp)


                                            }



                                        }


                                        async function getResponse(worker) {

                                            var tcp = await getTCP(ip_address, worker);
                                            return 'ok';

                                        }



                                        // START
                                        getResponse(worker);


                                        function getTCP(host, worker) {

                                            var response;
                                            var check = 0;
                                            const nets = require('net');
                                            const clients = nets.createConnection({
                                                host: host,
                                                port: 4028
                                            }, () => {
                                                clients.write("summary+pools+devs");
                                                console.log("Fetching TCP: " + worker + " (" + host + ")");
                                            });

                                            clients.on('end', () => {});

                                            setTimeout(function() {
                                                if (check === 0) {
                                                    callbacktcp(worker, "timeout", host); // send response to callback function
                                                    clients.end(); // close connection
                                                }
                                            }, 5000);

                                            clients.on('data', (data) => {
                                                if (check === 0) {
                                                    response += data.toString();
                                                    callbacktcp(worker, response, host); // send response to callback function
                                                    check = 1;
                                                }
                                                clients.end(); // close connection
                                            });

                                            return response;


                                        }

                                        // Fetch SSH

                                        const getSSH = async (ip_address, login, passw, folder, command, worker, tcp) => {


                                            var response = "";
                                            console.log(worker + ": " + ip_address + " " + login + "/" + passw + " in - " + folder + " -  exec: " + command);

                                            ssh2.connect({
                                                host: ip_address,
                                                username: login,
                                                password: passw,
                                            }).then(function() {

                                                // Command
                                                ssh2.execCommand(command, {
                                                    cwd: folder
                                                }).then(function(result) {
                                                    console.log("Fetching SSH:" + ip_address);
                                                    response = result.stdout;
                                                    response = response.trim();

                                                    callbackssh(worker, tcp, response)

                                                }).catch((error) => {
                                                    console.log(colors.red("Authentication failed on: " + worker + " with: " + login + "/" + passw));
                                                });

                                                return response;


                                            })

                                        }

                                    }


                                    // Send Full JSON Data to the Endpoint

                                    var _flagCheck = setInterval(function() {
                                        if (sync_done === true) {
                                            clearInterval(_flagCheck);


                                            needle.post('https://api.minerstat.com/api/get_asic.php', {
                                                    node: JSON.stringify(o)
                                                },
                                                function(err, resp, body) {
                                                    console.log(body);
                                                    console.log(colors.green("/*/*/*/*/*/*/*/*/*/*/*/*/*/*/"));
                                                    console.log(colors.green(getDateTime() + " MINERSTAT.COM: Package Sent"));
                                                    console.log(colors.green("*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/"));
                                                });


                                            updateStatus(connection, "Waiting for the next sync round.");
                                            // Print Json what sent to the server
                                            //console.log(o);

                                            console.log("");
                                            console.log(colors.cyan("/*/*/*/*/*/*/*/*/*/*/*/*/*/*/"));
                                            console.log(colors.cyan("Waiting for the next sync round."));
                                            console.log(colors.cyan("/*/*/*/*/*/*/*/*/*/*/*/*/*/*/"));
                                            console.log("");

                                            // Start New Round after 25 sec idle
                                            setTimeout(function() {
                                                var main = require('./main');
                                                main.sync();
                                            }, 25000);


                                        }
                                    }, 5000); // interval set at 100 milliseconds



                                }


                            }) // Config exist?	  
                    }
                }
            }
        }
    }
}