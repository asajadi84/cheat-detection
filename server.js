const _ = require("lodash");
const express = require("express");
const fs = require("fs");
const open = require("open");
const papa = require("papaparse");
const Mind = require("node-mind");
const ml = require("machine_learning");
const logDir = __dirname + "/datasetlog";

const app = express();
app.set("view engine", "ejs");
app.use("/", express.static("public"));

let finalDataset = [];

app.get("/", function(req, res){

    var datasetCode = "1";
    if(req.query.dataset){
        datasetCode = req.query.dataset;
    }

    const answersFile = fs.readFileSync(__dirname + "/datasets/dataset" + datasetCode + "/answers.csv", {encoding: "utf-8"});
    const examsFile = fs.readFileSync(__dirname + "/datasets/dataset" + datasetCode + "/exams.csv", {encoding: "utf-8"});
    const individualsFile = fs.readFileSync(__dirname + "/datasets/dataset" + datasetCode + "/individuals.csv", {encoding: "utf-8"});

    let answersFileArray;
    papa.parse(answersFile, {
        header: true,
        complete: function(results){
            answersFileArray = results.data;
        }
    });
    let examsFileArray;
    papa.parse(examsFile, {
        header: true,
        complete: function(results){
            examsFileArray = results.data;
        }
    });
    let individualsFileArray;
    papa.parse(individualsFile, {
        header: true,
        complete: function(results){
            individualsFileArray = results.data;
        }
    });

    let examsByExamID = _.groupBy(examsFileArray, "ExamID");
    let examSessions = [];
    _.forEach(examsByExamID, function(examSession){

        examSessions.push(examSession[0].Title);

        let studentsAttributes = [];
        _.forEach(examSession, function(examinee){
            if(examinee.UserName.startsWith("s") && examinee.EntranceTime != "NULL" && examinee.ExamEndTime != "NULL"){
                studentsAttributes.push([examinee.UserName, examinee.IPAddress,
                    hardcodedTimeToUnix(examinee.EntranceTime), hardcodedTimeToUnix(examinee.ExamEndTime),
                    examinee.FinalGrade, _.find(individualsFileArray, ["UserName", examinee.UserName]).GPA]);
            }
        });

        let studentsExamAnswers = [];
        _.forEach(studentsAttributes, function(examinee){
            studentsExamAnswers.push(
                _.chain(answersFileArray)
                .filter({"ExamID": examSession[0].ExamID, "UserName": examinee[0]})
                .sortBy(row => row.QuestionID)
                .map(row => row.UserRespnse)
                .concat(examinee[0])
                .value()
            );
        });

        //Layer 1 cheat detection => statistical methods
        let studentCheatStatusLayer1 = [];
        _.forEach(studentsAttributes, function(examinee){
            let sharedIPCount = _.chain(studentsAttributes)
            .filter(o => o[1]==examinee[1])
            .size()
            .value();

            let examEntranceMinTime = _.chain(studentsAttributes)
            .minBy(o => o[2])
            .value()[2];
            let examEndMaxTime = _.chain(studentsAttributes)
            .maxBy(o => o[3])
            .value()[3];
            let maxDurationPossible = examEndMaxTime - examEntranceMinTime;

            let sharedIPCheatDetected = sharedIPCount > 1;
            let examDurationCheatDetected = examinee[3] < examEntranceMinTime + (maxDurationPossible / 4);
            let examDelayCheatDetected = examinee[2] > examEntranceMinTime + (maxDurationPossible / 20);

            studentCheatStatusLayer1.push([sharedIPCheatDetected, examDurationCheatDetected, examDelayCheatDetected]);
        });

        //Layer 2 cheat detection => test results similarity algorithm
        let studentCheatStatusLayer2 = [];
        let studentsWithMostSimilarAnswers = [];
        _.forEach(studentsAttributes, function(examinee, examineeIndex){
            studentsWithMostSimilarAnswers.push(
                _.chain(studentsExamAnswers)
                .sortBy(row => collectionAbsoluteDifference(studentsExamAnswers[examineeIndex], row))
                .filter(o => _.last(o) != studentsAttributes[examineeIndex][0])
                .slice(0, 3)
                .map(row => _.last(row))
                .value()
            );
        });
        _.forEach(studentsWithMostSimilarAnswers, function(similarAnswer, i){

            let identicalIP = false;
            let similarEndTime = false;

            _.forEach(similarAnswer, function(similarStudent, j){
                let similarStudentIP = _.chain(studentsAttributes)
                .find(o => o[0] == similarStudent)
                .value()[1];
                if(similarStudentIP == studentsAttributes[i][1]){
                    identicalIP = true;
                }

                let similarEndTime = _.chain(studentsAttributes)
                .find(o => o[0] == similarStudent)
                .value()[3];
                if(Math.abs(similarEndTime - studentsAttributes[i][3]) < 600){
                    similarEndTime = true;
                }
            });

            studentCheatStatusLayer2.push([identicalIP, similarEndTime]);
        });

        //Layer 3 cheat detection => support vector machine (svm)
        let studentCheatStatusLayer3 = [];
        let currentExamDatasetb = examsByExamID[examSession[0].ExamID];
        let currentExamDatasetX = [];
        let currentExamDatasetY = [];
        _.forEach(currentExamDatasetb, function(datasetItem){
            if(datasetItem.UserName.startsWith("s") && datasetItem.FinalGrade != "0.00"){
                currentExamDatasetX.push([datasetItem.FinalGrade]);
                currentExamDatasetY.push(_.find(individualsFileArray, ["UserName", datasetItem.UserName]).GPA);
            }
        });

        _.forEach(studentsAttributes, function(examinee){

            var svm = new ml.SVM({
                x : currentExamDatasetX,
                y : currentExamDatasetY
            });

            svm.train({
                C : 1.1, // default : 1.0. C in SVM.
                tol : 1e-5, // default : 1e-4. Higher tolerance --> Higher precision
                max_passes : 20, // default : 20. Higher max_passes --> Higher precision
                alpha_tol : 1e-5, // default : 1e-5. Higher alpha_tolerance --> Higher precision
                kernel : { type: "polynomial", c: 1, d: 5}
            });

            studentCheatStatusLayer3.push([
                svm.predict([examinee[5]]) == 1 ? 0 : 100,
                svm.predict([examinee[5]]) == 1
            ]);
        });

        //Layer 3 cheat detection => data mining methods (knn)
        let studentCheatStatusLayer31 = [];
        let currentExamDataset = examsByExamID[examSession[0].ExamID];
        let currentExamDatasetKnn = [];
        let plotData = [];
        _.forEach(currentExamDataset, function(datasetItem){
            if(datasetItem.UserName.startsWith("s") && datasetItem.FinalGrade != "0.00"){
                currentExamDatasetKnn.push([
                    datasetItem.UserName,
                    datasetItem.FinalGrade,
                    _.find(individualsFileArray, ["UserName", datasetItem.UserName]).GPA
                ]);
            }
        });

        _.forEach(studentsAttributes, function(examinee){
            let accuracyPercentageVal = accuracyPercentage(knn([examinee[0], examinee[4], examinee[5]], currentExamDatasetKnn, 6), examinee[5]);
            studentCheatStatusLayer31.push([
                accuracyPercentageVal,
                accuracyPercentageVal < 90
            ]);

            let currentStudentX = 0;
            let currentStudentY = 0;
            let predictedStudentX = 0;

            let otherStudentsX = [];
            let otherStudentsY = [];
            let otherStudentsUserName = [];

            _.forEach(studentsAttributes, function(innerExaminee){
                if(innerExaminee[0] != examinee[0]){
                    otherStudentsX.push(innerExaminee[5]);
                    otherStudentsY.push(innerExaminee[4]);
                    otherStudentsUserName.push(innerExaminee[0]);
                }else{
                    currentStudentX = innerExaminee[5];
                    currentStudentY = innerExaminee[4];
                    predictedStudentX = knn([innerExaminee[0], innerExaminee[4], innerExaminee[5]], currentExamDatasetKnn, 6);
                }
            });

            plotData.push([
                {
                    x: otherStudentsX,
                    y: otherStudentsY,
                    mode: "markers+text",
                    type: "scatter",
                    name: "Other Students",
                    text: otherStudentsUserName
                },
                {
                    x: currentStudentX,
                    y: currentStudentY,
                    mode: "markers+text",
                    type: "scatter",
                    name: "This Student (Current)",
                    text: "This Student (Current)"
                },
                {
                    x: predictedStudentX,
                    y: currentStudentY,
                    mode: "markers+text",
                    type: "scatter",
                    name: "This Student (Prediction)",
                    text: "This Student (Prediction)"
                }
            ]);

        });

        //Layer 3 cheat detection => artificial neural network (ann)
        let studentCheatStatusLayer32 = [];
        let currentExamDatasetb3 = examsByExamID[examSession[0].ExamID];
        let currentExamDatasetAnn = [];
        _.forEach(currentExamDatasetb3, function(datasetItem){
            if(datasetItem.UserName.startsWith("s") && datasetItem.FinalGrade != "0.00"){
                currentExamDatasetAnn.push({
                    input: [dividedByTwenty(datasetItem.FinalGrade)],
                    output: [dividedByTwenty(_.find(individualsFileArray, ["UserName", datasetItem.UserName]).GPA)]
                });
            }
        });

        _.forEach(studentsAttributes, function(examinee){
            const mind = new Mind().learn(currentExamDatasetAnn).predict(examinee[5]);
            let accuracyPercentageVal = accuracyPercentage(mind * 20, examinee[5]);
            studentCheatStatusLayer32.push([
                accuracyPercentageVal,
                accuracyPercentageVal < 75
            ]);
        });

        //fs.appendFile(logDir + "/studentattributes.log", studentsAttributes + "\n---------------------\n", { flag: "a" }, (err) => {});

        finalDataset.push([studentsAttributes, studentCheatStatusLayer1, studentCheatStatusLayer2,
            studentsWithMostSimilarAnswers, studentCheatStatusLayer3, studentCheatStatusLayer31, studentCheatStatusLayer32]);
    });

    res.render("index", {examSessions: examSessions, finalDataset: finalDataset});
});

app.get("/plot", function(req, res){
    if(!req.query.test || !req.query.student){
        res.send("Error: Both test and student queries should be fulfilled.");
    }else{
        if(finalDataset[req.query.test][5][req.query.student]){
            res.render("plot", {
                i: req.query.test,
                j: req.query.student,
                plotData: finalDataset[req.query.test][5][req.query.student]
            });
        }else{
            res.send("Error: Either test or student query is invalid.");
        }
    }
});

const runningPort = 3000;
app.listen(runningPort, function(){
    console.log("The app is now running on port " + runningPort);
    let argv2 = "";
    if(process.argv[2]){
        argv2 = "/?dataset=" + process.argv[2];
    }
    open("http://localhost:" + runningPort + argv2);
});

function hardcodedTimeToUnix(hardcodedTime){
    return Math.round((new Date(hardcodedTime).getTime())/1000);
}

function collectionAbsoluteDifference(collection1, collection2){
    let collectionSize = _.size(collection1);
    let differenceValue = 0;
    _.forEach(collection1, function(value, i){
        if(value != collection2[i]){
            differenceValue++;
        }
    });
    return differenceValue / collectionSize;
};

function knn(testData, trainingDataset, k){
    if(trainingDataset.length){
        let prediction = _.chain(trainingDataset)
        .map(row => [row[0], absDistance(row[1], testData[1]), row[2]])
        .sortBy(row => row[1])
        .slice(0, k)
        .sumBy(o => o[2]*1)
        .divide(k)
        .value();
        
        return prediction;
    }else{
        return 0;
    }
}

function absDistance(a, b){
    return Math.abs(a-b);
}

function accuracyPercentage(a, b){
    if(a>b){
        return (b/a)*100;
    }else{
        return (a/b)*100;
    }
}

function dividedByTwenty(actualNumber){
    return actualNumber/20;
}