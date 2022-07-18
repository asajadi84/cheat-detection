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
    _.forEach(examsByExamID, function(examSession){

        let studentsAttributes = [];
        _.forEach(examSession, function(Examinee){
            if(Examinee.UserName.startsWith("s") && Examinee.EntranceTime != "NULL"){
                studentsAttributes.push([Examinee.UserName, Examinee.IPAddress,
                    hardcodedTimeToUnix(Examinee.EntranceTime), hardcodedTimeToUnix(Examinee.ExamEndTime),
                    Examinee.FinalGrade, _.find(individualsFileArray, ["UserName", Examinee.UserName]).GPA]);
            }
        });
        console.log(studentsAttributes);
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