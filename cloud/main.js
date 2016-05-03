var stripAccents = (function () {
    var in_chrs   = 'àáâãäçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
        out_chrs  = 'aaaaaceeeeiiiinooooouuuuyyAAAAACEEEEIIIINOOOOOUUUUY',
        chars_rgx = new RegExp('[' + in_chrs + ']', 'g'),
        transl    = {}, i,
        lookup    = function (m) { return transl[m] || m; };

    for (i=0; i<in_chrs.length; i++) {
        transl[ in_chrs[i] ] = out_chrs[i];
    }

    return function (s) { return s.replace(chars_rgx, lookup); }
})();

Parse.Cloud.beforeSave(Parse.User, function(request, response) {

    if (request.object.isNew()) {
        // Save initial deleted value
        request.object.set("deleted", 0);
    }

    // Search field to improve searching
    var name = request.object.get("name") ? stripAccents(request.object.get("name").toLowerCase()) : "";
    var email = request.object.get("email") ? request.object.get("email") : "";
    request.object.set("search", name + " " + email);

    var authData = request.object.get("authData");
    if (authData && authData.facebook) {
        request.object.set("facebook", authData.facebook.id);
    }

    response.success();

});

// Remove Installation duplicate before save
Parse.Cloud.beforeSave(Parse.Installation, function(request, response) {

    if (request.user) {
        var query = new Parse.Query(Parse.Installation);
        query.equalTo("user", request.user.id);
        query.equalTo("deviceId", request.object.get("deviceId"));
        query.first({
            useMasterKey: true,
            success: function(duplicate) {
                if (duplicate && duplicate.id != request.object.id) {
                    console.warn("Another Installation already exists. " + duplicate.id);
                    duplicate.destroy({ useMasterKey: true }).then(function(duplicate) {
                        console.log("The Installation duplicate was deleted.");
                        response.success();
                    }, function(error) {
                        // Handle error
                        console.error("Error deleting an Installation duplicate. " + error.code + " : " + error.message);
                        response.success();
                    });
                } else {
                    response.success();
                }
            },
            error: function(error) {
                // Handle error
                console.error("Error finding Installation duplicate. " + error.code + " : " + error.message);
                response.success();
            }
        });

    } else {
        response.success();
    }

});

// Remove Friendship duplicate before save
Parse.Cloud.beforeSave("Friendship", function(request, response) {

    var query = new Parse.Query("Friendship");
    query.equalTo("user", request.object.get("user"));
    query.equalTo("friend", request.object.get("friend"));
    query.equalTo("deleted", 0);
    query.first({
        useMasterKey: true,
        success: function(duplicate) {
            if (duplicate && duplicate.id != request.object.id) {
                console.warn("Another Friendship already exists. " + duplicate.id);
                duplicate.destroy({ useMasterKey: true }).then(function(duplicate) {
                    console.log("The Friendship duplicate was deleted.");
                    response.success();
                }, function(error) {
                    // Handle error
                    console.error("Error deleting an Friendship duplicate. " + error.code + " : " + error.message);
                    response.success();
                });
            } else {
                response.success();
            }
        },
        error: function(error) {
            // Handle error
            console.error("Error finding Friendship duplicates. " + error.code + " : " + error.message);
            response.success();
        }
    });

});

Parse.Cloud.afterSave("Friendship", function(request) {

    trash("Friendship");

});

Parse.Cloud.afterSave("Gift", function(request) {

    var owner = request.object.get("user");

    if (request.user && request.user.id != owner) { // Don't notify the owner's modification

        // Notify the user owns the updated gift.
        var query = new Parse.Query(Parse.Installation);
        query.equalTo("user", owner);
        Parse.Push.send({
            where: query,
            data: {
              type: "gift_updated",
              objectId: request.object.id
            }
        }, {useMasterKey: true}).then(() => {
            // Push was successful
            console.log("Push ['Your gift was just updated'] was sent to: " + owner);
        }, (error) => {
            // Handle error
            console.error("Error sending a push. " + error.code + " : " + error.message);
        });

    } else {

        // Receive notification when a friend update his/her gift
//        if (request.object.isNew() || request.object.get("deleted") == 1) {
            var friendship = new Parse.Query("Friendship");
            friendship.equalTo("deleted", 0);
            friendship.equalTo("friend", owner);
            friendship.find({
                success: function(results) {
                    if (results.length > 0) {
                        var friends = [];
                        for (var i = 0; i < results.length; i++) {
                            friends.push(results[i].get("user"));
                        }
                        //
                        var query = new Parse.Query(Parse.Installation);
                        query.containedIn("user", friends);
                        Parse.Push.send({
                            where: query,
                            data: {
                              type: "friend_gift_updated",
                              objectId: owner
                            }
                        }, {useMasterKey: true}).then(() => {
                            // Push was successful
                            console.log("Push ['A friend just updated his/her gift'] was sent to: " + friends);
                        }, (error) => {
                            // Handle error
                            console.error("Error sending a push. " + error.code + " : " + error.message);
                        });
                    }
                },
                error: function(error) {
                    // Handle error
                    console.error("Error finding friendship. " + error.code + " : " + error.message);
                }
            });
//        }
    }

    trash("Gift");

});

function trash(className) {

    var d = new Date();
    var day = (24 * 3600 * 1000); // A day ago
    var yesterday = new Date(d.getTime() - (day));

    var deleted = new Parse.Query(className);
    deleted.equalTo("deleted", 1);
    deleted.lessThan("updatedAt", yesterday);
    deleted.find({
        success: function(results) {
            if (results.length > 0) {
                var objects = [];
                for (var i = 0; i < results.length; i++) {
                    var object = results[i];
                    object.destroy({ useMasterKey: true }).then(function(obj) {
                        console.log(className + "['" + obj.id + "'] was trashed");
                    }, function(error) {
                        // Handle error
                        console.error("Error trashing an object. " + error.code + " : " + error.message);
                    });
                    objects.push(object.id);
                }
                console.log("Trashing " + className + "[" + objects + "]");
            }
        },
        error: function(error) {
            // Handle error
            console.error("Error finding trash " + className + ": " + error.code + " : " + error.message);
        }
    });

};

// Ask a friend for gift

Parse.Cloud.define("askFriendForGift", function(request, response) {

    var friend = request.params.friend;

    var query = new Parse.Query(Parse.Installation);
    query.equalTo("user", friend);
    Parse.Push.send({
        where: query,
        data: {
          type: "ask_friend_for_gift",
        }
    }, {useMasterKey: true}).then(() => {
        // Push was successful
        console.log("Push ['Ask friend for gift'] was sent to: " + friend);
        response.success("Ask sent!");
    }, (error) => {
        // Handle error
        console.error("Error sending a push. " + error.code + " : " + error.message);
        response.error("Uh oh, something went wrong");
    });

});

// Ask a friend for gift

Parse.Cloud.define("newFriendInvited", function(request, response) {

    var invited = request.user.id;
    var friend = request.params.friend;
    friendToInvited(friend, invited, response);

});

function friendToInvited(friend, invited, response) {

    // Find an existing friendship (friend -> invited)
    var friendship = new Parse.Query("Friendship");
    friendship.equalTo("deleted", 0);
    friendship.equalTo("user", friend);
    friendship.equalTo("friend", invited);
    friendship.find({
        success: function(results) {
            if (results.length == 0) {
                // Save the new friendship
                var newFriendship = new Parse.Object("Friendship");
                newFriendship.set("deleted", 0);
                newFriendship.set("favorite", 0);
                newFriendship.set("user", friend);
                newFriendship.set("friend", invited);
                var acl = new Parse.ACL();
                acl.setPublicReadAccess(true);
                var friendObject = new Parse.User();
                friendObject.id = friend;
                acl.setWriteAccess(friendObject, true);
                newFriendship.setACL(acl);
                newFriendship.save(null,{
                    success: function(newFriendship) {
                        console.log("New friendship saved");
                        pushNewFriendInvited(friend, invited, response);
                    },
                    error: function(error) {
                        // Handle error
                        console.error("Error saving friendship. " + error.code + " : " + error.message);
                        response.error("Uh oh, something went wrong");
                    }
                });
            } else {
                response.success();
            }
        },
        error: function(error) {
            // Handle error
            console.error("Error finding friendship. " + error.code + " : " + error.message);
            response.error("Uh oh, something went wrong");
        }
    });

}

function pushNewFriendInvited(friend, invited, response) {

    // Push
    var query = new Parse.Query(Parse.Installation);
    query.equalTo("user", friend);
    Parse.Push.send({
        where: query,
        data: {
          type: "new_friend_invited",
          objectId: invited
        }
    }, {useMasterKey: true}).then(() => {
        // Push was successful
        console.log("Push ['New friend invited'] was sent to: " + friend);
        response.success();
    }, (error) => {
        // Handle error
        console.error("Error sending a push. " + error.code + " : " + error.message);
        response.error("Uh oh, something went wrong");
    });

}


