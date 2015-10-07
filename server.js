var express = require('express');
//for reading forms...
var bodyParser = require('body-parser');
var url = require('url');

var azure = require('azure-storage');
var uuid = require('node-uuid');
var nconf = require('nconf');


nconf.env().file({ file: 'config.json', search: true });

//any config defaults
nconf.defaults({ 'PORT': 80, 'NODE_ENV': 'PROD' });

//get the server port and env.
var port = nconf.get("PORT");
var node_env = nconf.get("NODE_ENV");

//basic azure stuff (will have to add these from your azure account)
var accountName = nconf.get("STORAGE_NAME");
var accountKey = nconf.get("STORAGE_KEY");

//this will be where all surveys are stored
var tableName = nconf.get("TABLE_NAME");

//this will be for each survey (should be in code)
var partitionKey = "";

//setup express
var app = express();
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));

//setup table service
var retryOperations = new azure.ExponentialRetryPolicyFilter();
var tableSvc = azure.createTableService(accountName, accountKey).withFilter(retryOperations);
var entityGen = azure.TableUtilities.entityGenerator;



app.get('/', function (req, res) {
    res.type('text/plain'); // set content-type
    res.send('welcome to my survey app'); // send text response
});

app.get('/survey/:survey', function (req, res) {
    console.log('Looking up survey \: ' + req.params.survey);
    querySurvey(req.params.survey, function (resp) {
        res.json(resp);
    });
});

app.get('/survey/:survey/:question/chart', function (req, res) {
    console.log('Chart \: ' + req.params.survey + " Question: " + req.params.question);

    res.format({
        html: function () {
            res.sendfile("./chart.html");
        },

        json: function () {
            querySurveyQuestion(req.params.survey, req.params.question, function (resp) {

                var question = resp.body.question,
                    answers = JSON.parse(resp.body.answers),
                    totals = JSON.parse(resp.body.totals),
                    results = [], i = -1;
                
                //lets map the two arrays into a single multivalued array for google charts    
                //results.push(["Answers", "Totals", "Text"]);

                while (answers[++i]) {
                    results.push([answers[i], totals[i], totals[i]]);
                }
                var newResp = {
                    "question": question,
                    "results": results,
                    "updated": resp.body.Timestamp
                }

                res.json(newResp);
            });
        }
    });
});

app.get('/survey/:survey/:question', function (req, res) {
    console.log('Querying \: ' + req.params.survey + " Question: " + req.params.question);
    querySurveyQuestion(req.params.survey, req.params.question, function (resp) {
        //probably want to check for errors or something...
        
        res.format({
            html: function () {
                //could use handlebars and then use a template
                //res.sendfile("./question.html");
                var html = '<!DOCTYPE html>' +
                    '<html>' +
                    ' <head>' +
                    '   <meta name="viewport" content="initial-scale=1.0, user-scalable=no">' +
                    '   <meta charset="utf-8">' +
                    '   <title>Question: ' + resp.body.question + '</title>' +
                    ' </head>' +
                    ' <body>' +
                    '     <form method="post">' +
                    '         <h1>' + resp.body.question + '</h1>';

                var answers = JSON.parse(resp.body.answers);
                
                for (var i=0; i < answers.length; i++){
                    html = html + '<input type="radio" name="answer" value="' + i.toString() + '"><label for="test1">' + answers[i] + '</label>';
                }

                html = html + '<div>' +
                '             <button type="submit" name="action">Sumbit</button>' +
                '         </div>' +
                '     </form>' +
                ' </body>' +
                '</html>';

                res.send(html);
            },

            json: function () {
                res.json(resp);
            }
        });
    });
});

app.post('/survey/:survey/:question', function (req, res) {
    console.log('Updating \: ' + req.params.survey + " Question: " + req.params.question);
    //if you were posting in via json, you could do a different response, and not redirect
    // something like...  telling the SPA where to redirect to: res.send({redirect: '/chart'});
    updateSurveyQuestion(req.params.survey, req.params.question, req.body.answer, function (resp) {
        res.redirect( req.params.question + '/chart');
    });
});

/* let's use the post method above instead

app.get('/survey/:survey/:question/:answer', function (req, res) {
    console.log('Updating \: ' + req.params.survey + " Question: " + req.params.question);
    updateSurveyQuestion(req.params.survey, req.params.question, req.params.answer, function (resp) {
        res.json(resp);
    });
});
*/


app.get('/admin/create/:survey', function (req, res) {
    console.log('Created a basic survey: ' + req.params.survey);
    createSurvey(req.params.survey, function (resp) {
        res.json(resp);
    });
});

app.get('/admin/delete/:survey/:question', function (req, res) {

    res.writeHead(200, { "Content-Type": "application/json" });
    console.log('Deleted a basic survey: ' + req.params.survey + " Question: " + req.params.question);
    deleteSurveyRow(req.params.survey, req.params.question, function (resp) {
        res.write(resp);
        res.end();
    });
});

app.listen(port);


function createSurvey(surveyName, callback) {
    var entGen = azure.TableUtilities.entityGenerator;

    var info = {
        PartitionKey: entGen.String(surveyName),
        RowKey: entGen.String("info"),
        title: entGen.String('Survey One Title'),
        description: entGen.String('Survey One Description....'),
        dueDate: entGen.DateTime(new Date(Date.UTC(2015, 11, 1)))
    };

    var question1 = {
        PartitionKey: entGen.String(surveyName),
        RowKey: entGen.String("1"),
        question: entGen.String('What would you like to do today?'),
        answers: entGen.String('["Nothing","Everything"]'),
        totals: entGen.String('[0,0]'),
    };

    var question2 = {
        PartitionKey: entGen.String(surveyName),
        RowKey: entGen.String("2"),
        question: entGen.String('What would you like to drink?'),
        answers: entGen.String('["water","Coffee","Juice"]'),
        totals: entGen.String('[0,0,0]'),
    };

    var batch = new azure.TableBatch();

    batch.insertEntity(info, { echoContent: true });
    batch.insertEntity(question1, { echoContent: true });
    batch.insertEntity(question2, { echoContent: true });

    tableSvc.executeBatch(tableName, batch, function (error, result, response) {
        if (!error) {
            // Survey inserted
            console.log("survey created!");
            callback(response);
        }
        if (error) {
            console.log("oh oh, problem creating survey: " + error)
            var jsonE = {
                "error": error
            };
            callback(jsonE);
        }
    });
}

function deleteSurveyRow(surveyName, surveyRow, callback) {
    var entGen = azure.TableUtilities.entityGenerator;

    var task = {
        PartitionKey: entGen.String(surveyName),
        RowKey: entGen.String(surveyRow)
    };

    tableSvc.deleteEntity(tableName, task, function (error, response) {
        if (!error) {
            // Survey deleted
            console.log("survey row deleted!");
            callback(response);
        }
        if (error) {
            console.log("oh oh, problem deleting survey row: " + error)
            var jsonE = {
                "error": error
            };
            callback(jsonE);
        }
    });
}

function querySurvey(survey, callback) {
    var query = new azure.TableQuery()
        .top(5)
        .where('PartitionKey eq ? ', survey);

    tableSvc.queryEntities(tableName, query, null, function (error, result, response) {
        if (!error) {
            callback(response);
        }

        if (error) {
            console.log('on no, query failed: ' + error)
            var jsonE = {
                "error": error
            };
            callback(jsonE);
        }
    });
}

function querySurveyQuestion(surveyName, question, callback) {

    tableSvc.retrieveEntity(tableName, surveyName, question, function (error, result, response) {
        if (!error) {
            callback(response);
        }

        if (error) {
            console.log('on no, question query failed: ' + error)
            var jsonE = {
                "error": error
            };
            callback(jsonE);
        }
    });
}

function updateSurveyQuestion(surveyName, question, answer, callback) {
    var entGen = azure.TableUtilities.entityGenerator;

    querySurveyQuestion(surveyName, question, function (response) {
        var totals = JSON.parse(response.body.totals);
        
        //increment answer
        totals[answer]++;

        var survey = {
            PartitionKey: entGen.String(surveyName),
            RowKey: entGen.String(question),
            totals: entGen.String("[" + totals.toString() + "]"),
        };

        tableSvc.mergeEntity(tableName, survey, function (error, result, response) {
            if (!error) {
                callback(response);
            }
            if (error) {
                console.log('on no, update failed: ' + error)
                var jsonE = {
                    "error": error
                };
                callback(jsonE);
            }
        });
    });
}

function modifySurvey(survey2, callback) {
    var entGen = azure.TableUtilities.entityGenerator;

    var survey = {
        PartitionKey: entGen.String(partitionKey),
        RowKey: entGen.String("survey_one"),
        totals: entGen.String('{"t1" : ' + survey2 + ', "t2" : 0}'),
    };

    tableSvc.insertOrMergeEntity(tableName, survey, function (error, result, response) {
        if (!error) {
            callback(response);
        }
        if (error) {
            console.log('on no, update failed: ' + error)
            var jsonE = {
                "error": error
            };
            callback(jsonE);
        }
    });
}
