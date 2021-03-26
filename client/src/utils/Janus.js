import { Janus } from 'janus-gateway';

var server = null;
if(window.location.protocol === 'http:')
	server = "http://" + window.location.hostname + ":8088/janus";
else
	server = "https://" + window.location.hostname + ":8089/janus";

var janus = null;
var streaming = null;
var opaqueId = "streamingtest-"+Janus.randomString(12);

var bitrateTimer = null;
var spinner = null;

var simulcastStarted = false, svcStarted = false;

var selectedStream = null;


$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
		// Use a button to start the demo
		$('#start').one('click', function() {
			$(this).attr('disabled', true).unbind('click');
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				bootbox.alert("No WebRTC support... ");
				return;
			}
			// Create session
			janus = new Janus(
				{
					server: server,
					success: function() {
						// Attach to Streaming plugin
						janus.attach(
							{
								plugin: "janus.plugin.streaming",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
									$('#details').remove();
									streaming = pluginHandle;
									Janus.log("Plugin attached! (" + streaming.getPlugin() + ", id=" + streaming.getId() + ")");
									// Setup streaming session
									$('#update-streams').click(updateStreamsList);
									updateStreamsList();
									$('#start').removeAttr('disabled').html("Stop")
										.click(function() {
											$(this).attr('disabled', true);
											clearInterval(bitrateTimer);
											janus.destroy();
											$('#streamslist').attr('disabled', true);
											$('#watch').attr('disabled', true).unbind('click');
											$('#start').attr('disabled', true).html("Bye").unbind('click');
										});
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin... ", error);
									bootbox.alert("Error attaching plugin... " + error);
								},
								iceState: function(state) {
									Janus.log("ICE state changed to " + state);
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message :::", msg);
									var result = msg["result"];
									if(result) {
										if(result["status"]) {
											var status = result["status"];
											if(status === 'starting')
												$('#status').removeClass('hide').text("Starting, please wait...").show();
											else if(status === 'started')
												$('#status').removeClass('hide').text("Started").show();
											else if(status === 'stopped')
												stopStream();
										} else if(msg["streaming"] === "event") {
											// Is simulcast in place?
											var substream = result["substream"];
											var temporal = result["temporal"];
											if((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
												if(!simulcastStarted) {
													simulcastStarted = true;
													addSimulcastButtons(temporal !== null && temporal !== undefined);
												}
												// We just received notice that there's been a switch, update the buttons
												updateSimulcastButtons(substream, temporal);
											}
											// Is VP9/SVC in place?
											var spatial = result["spatial_layer"];
											temporal = result["temporal_layer"];
											if((spatial !== null && spatial !== undefined) || (temporal !== null && temporal !== undefined)) {
												if(!svcStarted) {
													svcStarted = true;
													addSvcButtons();
												}
												// We just received notice that there's been a switch, update the buttons
												updateSvcButtons(spatial, temporal);
											}
										}
									} else if(msg["error"]) {
										bootbox.alert(msg["error"]);
										stopStream();
										return;
									}
									if(jsep) {
										Janus.debug("Handling SDP as well...", jsep);
										var stereo = (jsep.sdp.indexOf("stereo=1") !== -1);
										// Offer from the plugin, let's answer
										streaming.createAnswer(
											{
												jsep: jsep,
												// We want recvonly audio/video and, if negotiated, datachannels
												media: { audioSend: false, videoSend: false, data: true },
												customizeSdp: function(jsep) {
													if(stereo && jsep.sdp.indexOf("stereo=1") == -1) {
														// Make sure that our offer contains stereo too
														jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
													}
												},
												success: function(jsep) {
													Janus.debug("Got SDP!", jsep);
													var body = { request: "start" };
													streaming.send({ message: body, jsep: jsep });
													$('#watch').html("Stop").removeAttr('disabled').click(stopStream);
												},
												error: function(error) {
													Janus.error("WebRTC error:", error);
													bootbox.alert("WebRTC error... " + error.message);
												}
											});
									}
								},
								onremotestream: function(stream) {
									Janus.debug(" ::: Got a remote stream :::", stream);
									var addButtons = false;
									if($('#remotevideo').length === 0) {
										addButtons = true;
										$('#stream').append('<video class="rounded centered hide" id="remotevideo" width="100%" height="100%" playsinline/>');
										$('#remotevideo').get(0).volume = 0;
										// Show the stream and hide the spinner when we get a playing event
										$("#remotevideo").bind("playing", function () {
											$('#waitingvideo').remove();
											if(this.videoWidth)
												$('#remotevideo').removeClass('hide').show();
											if(spinner)
												spinner.stop();
											spinner = null;
											var videoTracks = stream.getVideoTracks();
											if(!videoTracks || videoTracks.length === 0)
												return;
											var width = this.videoWidth;
											var height = this.videoHeight;
											$('#curres').removeClass('hide').text(width+'x'+height).show();
											if(Janus.webRTCAdapter.browserDetails.browser === "firefox") {
												// Firefox Stable has a bug: width and height are not immediately available after a playing
												setTimeout(function() {
													var width = $("#remotevideo").get(0).videoWidth;
													var height = $("#remotevideo").get(0).videoHeight;
													$('#curres').removeClass('hide').text(width+'x'+height).show();
												}, 2000);
											}
										});
									}
									Janus.attachMediaStream($('#remotevideo').get(0), stream);
									$("#remotevideo").get(0).play();
									$("#remotevideo").get(0).volume = 1;
									var videoTracks = stream.getVideoTracks();
									if(!videoTracks || videoTracks.length === 0) {
										// No remote video
										$('#remotevideo').hide();
										if($('#stream .no-video-container').length === 0) {
											$('#stream').append(
												'<div class="no-video-container">' +
													'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
													'<span class="no-video-text">No remote video available</span>' +
												'</div>');
										}
									} else {
										$('#stream .no-video-container').remove();
										$('#remotevideo').removeClass('hide').show();
									}
									if(!addButtons)
										return;
									if(videoTracks && videoTracks.length &&
											(Janus.webRTCAdapter.browserDetails.browser === "chrome" ||
												Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
												Janus.webRTCAdapter.browserDetails.browser === "safari")) {
										$('#curbitrate').removeClass('hide').show();
										bitrateTimer = setInterval(function() {
											// Display updated bitrate, if supported
											var bitrate = streaming.getBitrate();
											$('#curbitrate').text(bitrate);
											// Check if the resolution changed too
											var width = $("#remotevideo").get(0).videoWidth;
											var height = $("#remotevideo").get(0).videoHeight;
											if(width > 0 && height > 0)
												$('#curres').removeClass('hide').text(width+'x'+height).show();
										}, 1000);
									}
								},
								ondataopen: function(data) {
									Janus.log("The DataChannel is available!");
									$('#waitingvideo').remove();
									$('#stream').append(
										'<input class="form-control" type="text" id="datarecv" disabled></input>'
									);
									if(spinner)
										spinner.stop();
									spinner = null;
								},
								ondata: function(data) {
									Janus.debug("We got data from the DataChannel!", data);
									$('#datarecv').val(data);
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									$('#waitingvideo').remove();
									$('#remotevideo').remove();
									$('#datarecv').remove();
									$('.no-video-container').remove();
									$('#bitrate').attr('disabled', true);
									$('#bitrateset').html('Bandwidth<span class="caret"></span>');
									$('#curbitrate').hide();
									if(bitrateTimer)
										clearInterval(bitrateTimer);
									bitrateTimer = null;
									$('#curres').hide();
									$('#simulcast').remove();
									$('#metadata').empty();
									$('#info').addClass('hide').hide();
									simulcastStarted = false;
								}
							});
					},
					error: function(error) {
						Janus.error(error);
						bootbox.alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});
		});
	}});
});