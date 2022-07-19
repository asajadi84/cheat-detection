const _ = require("lodash");
const express = require("express");
const fs = require("fs");
const open = require("open");
const papa = require("papaparse");
const tf = require("@tensorflow/tfjs");

const app = express();
app.set("view engine", "ejs");
app.use("/", express.static("public"));

app.get("/", function(req, res){

    const answersFile = fs.readFileSync(__dirname + "/dataset/answers.csv", {encoding: "utf-8"});
    const examsFile = fs.readFileSync(__dirname + "/dataset/exams.csv", {encoding: "utf-8"});
    const individualsFile = fs.readFileSync(__dirname + "/dataset/individuals.csv", {encoding: "utf-8"});

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

    let finalDataset = [];

    let examsByExamID = _.groupBy(examsFileArray, "ExamID");
    let examSessions = [];
    _.forEach(examsByExamID, function(examSession){

        examSessions.push(examSession[0].Title);

        let studentsAttributes = [];
        _.forEach(examSession, function(examinee){
            if(examinee.UserName.startsWith("s") && examinee.EntranceTime != "NULL"){
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
            let examDelayCheatDetected = examinee[2] > examEntranceMinTime + 600;

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

        //Layer 3 cheat detection => data mining methods (knn)
        let studentCheatStatusLayer3 = [];
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
            studentCheatStatusLayer3.push([
                accuracyPercentageVal,
                accuracyPercentageVal < 90
            ]);
        });

        finalDataset.push([studentsAttributes, studentCheatStatusLayer1, studentCheatStatusLayer2,
            studentsWithMostSimilarAnswers, studentCheatStatusLayer3, plotData]);
    });

    res.render("index", {finalDataset: finalDataset});
});

const runningPort = 3000;
app.listen(runningPort, function(){
    console.log("The app is now running on port " + runningPort);
    open("http://localhost:" + runningPort);
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