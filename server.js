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
        let studentsWithMostSimilaryAnswers = [];
        _.forEach(studentsAttributes, function(examinee, examineeIndex){
            studentsWithMostSimilaryAnswers.push(
                _.chain(studentsExamAnswers)
                .sortBy(row => collectionAbsoluteDifference(studentsExamAnswers[examineeIndex], row))
                .filter(o => _.last(o) != studentsAttributes[examineeIndex][0])
                .slice(0, 3)
                .map(row => _.last(row))
                .value()
            );
        });
        _.forEach(studentsWithMostSimilaryAnswers, function(similarAnswer, i){

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
                if(Math.abs(similarEndTime - studentsAttributes[i][3]) < 300){
                    similarEndTime = true;
                }

                console.log(similarEndTime);
                console.log(studentsAttributes[i][3]);
                console.log(Math.abs(similarEndTime - studentsAttributes[i][3]));
            });

            studentCheatStatusLayer2.push([identicalIP, similarEndTime]);
        });

        //console.log(studentsAttributes);
        //console.log(studentsExamAnswers);
        //console.log(studentCheatStatusLayer1);
        //console.log(studentCheatStatusLayer2);
        //console.log(studentsWithMostSimilaryAnswers);

        // let temp1 = [3, 3, 2, 1, 0];
        // let temp2 = [33, 33, 442, 13, 435435];
        // console.log(collectionAbsoluteDifference(temp1, temp2));

        console.log("-------------------------");


    });





    //res.render("salam", {});
    res.send("hello world");
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